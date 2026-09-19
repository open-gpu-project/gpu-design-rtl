#include "tracer_codec.h"

#include <glaze/beve/beve_to_json.hpp>
#include <glaze/json.hpp>
#include <map>

#include "exceptions.h"

using namespace framework;

namespace {

   /// @brief The raw JSON text of each element of a JSON array.
   std::vector<glz::raw_json> split_array(std::string_view json) {
      std::vector<glz::raw_json> parts{};
      if (auto ec = glz::read_json(parts, json); ec) {
         detail::throw_codec_error("Traced value does not match its schema",
                                   glz::format_error(ec, json));
      }
      return parts;
   }

   /// @brief The raw JSON text of each member of a JSON object.
   std::map<std::string, glz::raw_json> split_object(std::string_view json) {
      std::map<std::string, glz::raw_json> parts{};
      if (auto ec = glz::read_json(parts, json); ec) {
         detail::throw_codec_error("Traced value does not match its schema",
                                   glz::format_error(ec, json));
      }
      return parts;
   }

   std::string write_string(std::string_view text) {
      std::string out{};
      if (auto ec = glz::write_json(text, out); ec) {
         detail::throw_codec_error("Failed to write a schema key", glz::format_error(ec));
      }
      return out;
   }

   /// @brief The first character that is not JSON whitespace, or '\0'.
   char first_token(std::string_view json) {
      auto const pos = json.find_first_not_of(" \t\n\r");
      return pos == std::string_view::npos ? '\0' : json[pos];
   }

   using enum_map = std::map<std::string, std::string>;

   /**
    * Replaces enumerator numbers with their names in `json`.
    *
    * Applied to whatever sits at one pointer, which for a container-typed field
    * is the container: BEVE holds the number at every depth, and write_json
    * prints the name at every depth, so the walk has to descend to match.
    *
    * An unrecognized number is left alone, so a stale sidecar shows up in the
    * output rather than being papered over.
    */
   std::string apply_enum(enum_map const* names, std::string_view json) {
      if (names == nullptr) {
         return std::string{json};
      }

      switch (first_token(json)) {
         case '[': {
            auto elements = split_array(json);
            std::string out{"["};
            for (std::size_t i = 0; i < elements.size(); ++i) {
               if (i > 0) {
                  out += ',';
               }
               out += apply_enum(names, elements[i].str);
            }
            out += ']';
            return out;
         }
         case '{': {
            auto entries = split_object(json);
            std::string out{"{"};
            bool first = true;
            for (auto const& [key, value] : entries) {
               if (!first) {
                  out += ',';
               }
               first = false;
               out += write_string(key);
               out += ':';
               out += apply_enum(names, value.str);
            }
            out += '}';
            return out;
         }
         default: {
            // A number, or `null` from a disengaged optional. Both are looked up
            // by their exact source text; only the former can ever match.
            auto const found = names->find(std::string{json});
            return found == names->end() ? std::string{json} : write_string(found->second);
         }
      }
   }

   enum_map const* find_enum(TraceSidecar const& sidecar, std::string_view pointer) {
      auto const found = sidecar.enums.find(pointer);
      return found == sidecar.enums.end() ? nullptr : &found->second;
   }

} // namespace

void detail::throw_codec_error(std::string_view what, std::string_view reason) {
   throw GenericSimulationException(what, std::pair{"reason", std::string{reason}});
}

std::string detail::describe(glz::error_ctx const& ec) { return glz::format_error(ec); }

std::string detail::build_sidecar(std::string_view schema_json,
                                  std::vector<std::string> const& order,
                                  bool root_is_struct,
                                  std::map<std::string, enum_map> const& enums) {
   // Decomposed into raw members rather than reparsed through a DOM. A generic
   // JSON value would have to pick a number representation, and Glaze's own
   // schema text contains the uint64_t bound 18446744073709551615, which no
   // signed or floating alternative can hold exactly. raw_json keeps the
   // source text verbatim and needs no number mode at all.
   std::map<std::string, glz::raw_json> document{};
   if (auto ec = glz::read_json(document, schema_json); ec) {
      throw_codec_error("Failed to read the JSON Schema Glaze produced",
                        glz::format_error(ec, schema_json));
   }

   auto as_member = [](auto const& value) {
      std::string text{};
      if (auto ec = glz::write_json(value, text); ec) {
         throw_codec_error("Failed to write a schema member", glz::format_error(ec));
      }
      return glz::raw_json{std::move(text)};
   };

   if (root_is_struct) {
      document["x-beve-order"] = as_member(order);
      document["x-beve-encoding"] = as_member(std::string_view{
            "untagged (structs_as_arrays); fields are positional in x-beve-order"});
   } else {
      document["x-beve-encoding"] = as_member(std::string_view{
            "untagged (structs_as_arrays); the root is a single self-describing BEVE value, so "
            "no keys were stripped and no order is needed"});
   }
   if (!enums.empty()) {
      document["x-beve-enum"] = as_member(enums);
   }

   std::string out{};
   if (auto ec = glz::write_json(document, out); ec) {
      throw_codec_error("Failed to write a trace schema", glz::format_error(ec));
   }
   return out;
}

TraceSidecar framework::parse_sidecar(std::string_view json) {
   // Only the x-beve-* members are read back. The rest of the document is JSON
   // Schema proper: it describes the data for humans and for validators, but it
   // cannot decode it, having no record of the positional order.
   std::map<std::string, glz::raw_json> document{};
   if (auto ec = glz::read_json(document, json); ec) {
      detail::throw_codec_error("Failed to decode a trace schema", glz::format_error(ec, json));
   }

   auto read_member = [&](std::string_view key, auto& out) {
      auto const found = document.find(std::string{key});
      if (found == document.end()) {
         return;
      }
      if (auto ec = glz::read_json(out, found->second.str); ec) {
         detail::throw_codec_error("Failed to decode a trace schema",
                                   std::string{key} + ": " + glz::format_error(ec));
      }
   };

   TraceSidecar sidecar{};
   read_member("x-beve-order", sidecar.order);
   read_member("x-beve-enum", sidecar.enums);
   return sidecar;
}

std::string framework::reinterpret_to_json(TraceSidecar const& sidecar,
                                           std::string_view untagged_beve) {
   // Untagged BEVE still type-tags each value; it is only the struct field
   // names, and the names behind enumerator numbers, that are missing. So
   // Glaze can render the data on its own, and the sidecar's job is purely to
   // put those two things back.
   std::string json{};
   if (auto ec = glz::beve_to_json(untagged_beve, json); ec) {
      detail::throw_codec_error("Failed to read traced value as BEVE", glz::format_error(ec));
   }

   // No order means the schema describes one keyless root: untagged stripped
   // nothing, because a non-struct root has no keys to strip.
   if (sidecar.order.empty()) {
      return apply_enum(find_enum(sidecar, ""), json);
   }

   auto elements = split_array(json);
   if (elements.size() != sidecar.order.size()) {
      detail::throw_codec_error("Traced struct does not match its schema",
                                "expected " + std::to_string(sidecar.order.size()) +
                                      " fields, found " + std::to_string(elements.size()));
   }

   std::string out{"{"};
   for (std::size_t i = 0; i < elements.size(); ++i) {
      if (i > 0) {
         out += ',';
      }
      out += write_string(sidecar.order[i]);
      out += ':';
      // Pointers are relative to one value, matching x-beve-order's scope.
      out += apply_enum(find_enum(sidecar, "/" + sidecar.order[i]), elements[i].str);
   }
   out += '}';
   return out;
}
