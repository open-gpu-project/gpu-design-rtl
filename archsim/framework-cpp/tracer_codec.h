#pragma once

#include <concepts>
#include <cstddef>
#include <glaze/beve.hpp>
#include <glaze/json/schema.hpp>
#include <map>
#include <ranges>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace framework {

   namespace detail {

      template <typename T>
      concept trace_struct = glz::reflectable<T> || glz::glaze_object_t<T>;

      template <typename T>
      concept string_like = std::convertible_to<T const&, std::string_view>;

      template <typename T>
      concept optional_like = requires(T const& t) {
         typename T::value_type;
         { t.has_value() } -> std::convertible_to<bool>;
         { *t };
      };

      template <typename T>
      concept map_like = requires {
         typename T::key_type;
         typename T::mapped_type;
      };

      template <typename T>
      concept array_like = std::ranges::input_range<T> && !string_like<T> && !map_like<T>;

      template <typename T>
      concept scalar_like = std::is_arithmetic_v<T> || std::is_enum_v<T>;

      /// @brief Member type at index I. Stable across Glaze versions.
      template <typename T, std::size_t I>
      using member_t = std::remove_cvref_t<typename glz::reflect<T>::template type<I>>;

      /// @brief Whether a T occupies one positional slot in an untagged record.
      template <typename T>
      constexpr bool is_trace_leaf = [] {
         using U = std::remove_cvref_t<T>;
         if constexpr (trace_struct<U>) {
            return false; // a struct is never a leaf, however shallow
         } else if constexpr (scalar_like<U> ||
                              string_like<U>) { // string_like must be before array_like
            return true;
         } else if constexpr (optional_like<U>) {
            return is_trace_leaf<typename U::value_type>;
         } else if constexpr (map_like<U>) {
            return is_trace_leaf<typename U::mapped_type>;
         } else if constexpr (array_like<U>) {
            return is_trace_leaf<std::ranges::range_value_t<U>>;
         } else {
            return false;
         }
      }();

      template <typename T, std::size_t... Is>
      consteval bool members_are_leaves(std::index_sequence<Is...>) {
         return (is_trace_leaf<member_t<T, Is>> && ...);
      }

      /// @brief Extract the enum type inside a template arg or void if there is none.
      template <typename T>
      struct leaf_enum {
      private:
         using U = std::remove_cvref_t<T>;
         static consteval auto probe() {
            if constexpr (glz::is_named_enum<U>) {
               return std::type_identity<U>{};
            } else if constexpr (optional_like<U>) {
               return std::type_identity<typename leaf_enum<typename U::value_type>::type>{};
            } else if constexpr (map_like<U>) {
               return std::type_identity<typename leaf_enum<typename U::mapped_type>::type>{};
            } else if constexpr (array_like<U>) {
               return std::type_identity<typename leaf_enum<std::ranges::range_value_t<U>>::type>{};
            } else {
               return std::type_identity<void>{};
            }
         }

      public:
         using type = typename decltype(probe())::type;
      };

      template <typename T>
      using leaf_enum_t = typename leaf_enum<T>::type;

      /// @brief Maps Glaze enum value number (as string) to the enum string name.
      template <typename E>
      std::map<std::string, std::string> enum_value_names() {
         // Glaze represents enums as unsigned, and cannot handle signed enums
         static_assert(std::is_unsigned_v<std::underlying_type_t<E>>,
                       "A traced named enum must have an unsigned underlying type");
         std::map<std::string, std::string> names{};
         // enum_values_array is index-aligned with reflect<E>::keys and holds the real
         // enumerator values, unlike glz::enum_name_v which assumes value == index.
         for (std::size_t i = 0; i < static_cast<std::size_t>(glz::reflect<E>::size); ++i) {
            auto const wire = static_cast<unsigned long long>(glz::enum_values_array<E>[i]);
            names.emplace(std::to_string(wire), std::string{glz::reflect<E>::keys[i]});
         }
         return names;
      }

      /// @brief `x-beve-enum`: JSON Pointer, relative to one value, -> the names at it.
      template <typename T>
      std::map<std::string, std::map<std::string, std::string>> enum_pointers() {
         // is_named_enum, reached via leaf_enum, is exactly the set of enums write_json
         // prints as strings. std::is_enum_v would be wrong: it admits plain enums, whose
         // glz::reflect is an incomplete type, and whose number write_json prints anyway --
         // giving them an entry would make the reinterpreted JSON *diverge* from the typed
         // form rather than match it.
         std::map<std::string, std::map<std::string, std::string>> out{};
         if constexpr (!std::is_void_v<leaf_enum_t<T>>) {
            out[std::string{}] = enum_value_names<leaf_enum_t<T>>(); // "" is the whole value
         } else if constexpr (trace_struct<T>) {
            glz::for_each<static_cast<std::size_t>(glz::reflect<T>::size)>([&]<std::size_t I>() {
               using E = leaf_enum_t<glz::field_t<T, I>>;
               if constexpr (!std::is_void_v<E>) {
                  // C++ identifiers contain no '/' or '~', so no RFC 6901 escaping is needed.
                  out["/" + std::string{glz::reflect<T>::keys[I]}] = enum_value_names<E>();
               }
            });
         }
         return out;
      }

   } // namespace detail

   /// @brief A scalar, enum, string, or container of those: one positional slot.
   template <typename T>
   concept TraceLeaf = detail::is_trace_leaf<std::remove_cvref_t<T>>;

   /**
    * A traced type is either a leaf, or a struct exactly one level deep whose
    * members are all leaves. Deeper nesting is not supported.
    */
   template <typename T>
   concept Traceable =
         TraceLeaf<T> ||
         (detail::trace_struct<T> &&
          detail::members_are_leaves<T>(
                std::make_index_sequence<static_cast<std::size_t>(glz::reflect<T>::size)>{}));

   /**
    * The machine-readable part of a schema sidecar: what a reader needs in order
    * to re-map names back onto untagged bytes. The remainder is a JSON string.
    */
   struct TraceSidecar {
      /// @brief Field names in wire order. Empty means the root is a single value.
      std::vector<std::string> order{};
      /// @brief JSON Pointer -> wire number (as text) -> enumerator name.
      ///        The pointer "" refers to the whole value (RFC 6901).
      std::map<std::string, std::map<std::string, std::string>, std::less<>> enums{};

      bool operator==(TraceSidecar const&) const = default;
   };

   /**
    * Codec for encoding and decoding values of type T for tracing purposes.
    * The default implementation covers anything Glaze can reflect over; to
    * override it for a particular type, specialize this template.
    */
   template <typename T>
   class TracerCodec {
      static_assert(Traceable<T>,
                    "Traced types must be a scalar, enum, string, container of those, or a "
                    "struct one level deep whose members are all of the former. A nested "
                    "struct has no positional contract in the schema sidecar.");

   public:
      /// @brief Encodes a value as untagged BEVE.
      static std::string encode(T const& value) {
         std::string out{};
         encode_into(value, out);
         return out;
      }

      /// @brief Encodes into a caller-owned buffer, to avoid a per-record allocation.
      static void encode_into(T const& value, std::string& out) {
         if (auto ec = glz::write_beve_untagged(value, out); ec) {
            throw_encode_error(ec);
         }
      }

      /// @brief Decodes untagged BEVE produced by `encode()`.
      static T decode(std::string_view data) {
         T value{};
         if (auto ec = glz::read_beve_untagged(value, data); ec) {
            throw_decode_error(ec);
         }
         return value;
      }

      /**
       * The schema for T: JSON Schema text, as produced by Glaze, extended with
       * the `x-beve-*` members that untagged BEVE needs.
       */
      static std::string encode_schema();

   private:
      [[noreturn]]
      static void throw_encode_error(glz::error_ctx const&);
      [[noreturn]]
      static void throw_decode_error(glz::error_ctx const&);
   };

   /// @brief Reads the `x-beve-*` members of a sidecar produced by `encode_schema()`.
   TraceSidecar parse_sidecar(std::string_view json);

   /**
    * Restores field names and enumerator names onto untagged BEVE, producing
    * tagged JSON. It requires no compile-time knowledge of the traced type.
    */
   std::string reinterpret_to_json(TraceSidecar const& sidecar, std::string_view untagged_beve);

   namespace detail {
      [[noreturn]]
      void throw_codec_error(std::string_view what, std::string_view detail);
      std::string describe(glz::error_ctx const& ec);

      /// @brief `write_json_schema<T>()` text plus the injected `x-beve-*` members.
      std::string build_sidecar(
            std::string_view schema_json,
            std::vector<std::string> const& order,
            bool root_is_struct,
            std::map<std::string, std::map<std::string, std::string>> const& enums);
   } // namespace detail

   template <typename T>
   std::string TracerCodec<T>::encode_schema() {
      // Dump the Glaze schema JSON
      auto schema_json = glz::write_json_schema<T>();
      if (!schema_json.has_value()) {
         throw_encode_error(schema_json.error());
      }

      // Glaze properties are alphabetical, so we need to save the ordering
      std::vector<std::string> order{};
      if constexpr (detail::trace_struct<T>) {
         order.reserve(static_cast<std::size_t>(glz::reflect<T>::size));
         for (auto const& key : glz::reflect<T>::keys) {
            order.emplace_back(key);
         }
      }

      return detail::build_sidecar(
            schema_json.value(), order, detail::trace_struct<T>, detail::enum_pointers<T>());
   }

   template <typename T>
   void TracerCodec<T>::throw_encode_error(glz::error_ctx const& ec) {
      detail::throw_codec_error("Failed to encode a traced value", detail::describe(ec));
   }

   template <typename T>
   void TracerCodec<T>::throw_decode_error(glz::error_ctx const& ec) {
      detail::throw_codec_error("Failed to decode a traced value", detail::describe(ec));
   }

} // namespace framework
