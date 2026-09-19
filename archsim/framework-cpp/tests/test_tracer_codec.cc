/**
 * This file contains the unit tests for tracer_codec.cc/h
 */

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <glaze/beve/beve_to_json.hpp>
#include <glaze/json.hpp>
#include <limits>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/tracer_codec.h"

// Glaze's reflection takes the address of a static of each reflected type, so
// these fixtures need linkage and cannot live in an anonymous namespace.
namespace codec_test {

   using namespace framework;

   // Deliberately not in alphabetical order: glaze emits JSON Schema
   // `properties` sorted, so a test that only ever saw sorted field names
   // could not tell x-beve-order apart from it.
   struct Flat {
      int32_t zulu;
      double alpha;
      std::string mike;
      bool bravo;

      bool operator==(Flat const&) const = default;
   };

   struct Wide {
      uint64_t big;
      float single;

      bool operator==(Wide const&) const = default;
   };

   // Values that are neither sequential nor zero-based, so a map keyed by
   // enumerator value cannot be mistaken for one keyed by position.
   enum class Status : uint8_t { pending = 1, active = 2, retired = 10 };

   /// @brief A plain enum: no glz::meta, so Glaze writes its number, not a name.
   enum class Plain : uint8_t { off = 0, on = 1 };

   struct Stateful {
      int32_t id;
      Status status;
      Plain plain;
      std::vector<Status> history;
      std::optional<Status> maybe;

      bool operator==(Stateful const&) const = default;
   };

   /// @brief A single u8 field, for feeding a hand-written sidecar.
   struct Holder {
      uint8_t value;
   };

   /// @brief A struct member: one level too deep for a positional sidecar.
   struct Nested {
      Flat inner;

      bool operator==(Nested const&) const = default;
   };

   Flat const flat{.zulu = -7, .alpha = 2.5, .mike = "hi \"there\"", .bravo = true};
   Stateful const stateful{.id = 7,
                           .status = Status::active,
                           .plain = Plain::on,
                           .history = {Status::pending, Status::retired},
                           .maybe = Status::retired};

   // Untagged data is positional, so every field has a slot whether or not it
   // holds a value -- and so the reinterpreted JSON always names every field.
   // Glaze drops null members by default, so the reference has to opt out.
   constexpr glz::opts tagged_opts{.format = glz::JSON, .skip_null_members = false};

   /// @brief What Glaze writes for a value with its field names intact.
   template <typename T>
   std::string tagged_json(T const& value) {
      std::string out{};
      REQUIRE(!glz::write<tagged_opts>(value, out));
      return out;
   }

   /// @brief The untagged bytes rendered through a separately serialized schema.
   template <typename T>
   std::string reinterpreted(T const& value) {
      auto sidecar = parse_sidecar(TracerCodec<T>::encode_schema());
      return reinterpret_to_json(sidecar, TracerCodec<T>::encode(value));
   }

   /// @brief The schema sidecar decomposed into its raw JSON members.
   template <typename T>
   std::map<std::string, glz::raw_json> schema_members() {
      std::map<std::string, glz::raw_json> members{};
      REQUIRE(!glz::read_json(members, TracerCodec<T>::encode_schema()));
      return members;
   }

} // namespace codec_test

template <>
struct glz::meta<codec_test::Status> {
   using enum codec_test::Status;
   static constexpr auto value = enumerate(pending, active, retired);
};

using namespace codec_test;

TEST_CASE("tracer_codec: A schema is a JSON Schema plus a positional sidecar") {
   auto members = schema_members<Flat>();

   SECTION("carrying the JSON Schema Glaze produces") {
      REQUIRE(members.contains("properties"));
      REQUIRE(members.at("type").str == R"("object")");
   }

   SECTION("recording declaration order, which sorted properties cannot supply") {
      REQUIRE(members.at("x-beve-order").str == R"(["zulu","alpha","mike","bravo"])");
   }

   SECTION("naming the encoding the order belongs to") {
      REQUIRE(members.at("x-beve-encoding").str.contains("x-beve-order"));
   }

   SECTION("parsing back into the order a reader applies") {
      auto sidecar = parse_sidecar(TracerCodec<Flat>::encode_schema());
      REQUIRE(sidecar.order == std::vector<std::string>{"zulu", "alpha", "mike", "bravo"});
      REQUIRE(sidecar.enums.empty());
   }
}

TEST_CASE("tracer_codec: A schema maps every named enumerator to its wire number") {
   auto sidecar = parse_sidecar(TracerCodec<Stateful>::encode_schema());

   SECTION("keyed by value rather than by position") {
      REQUIRE(sidecar.enums.at("/status") == std::map<std::string, std::string>{{"1", "pending"},
                                                                                {"2", "active"},
                                                                                {"10", "retired"}});
   }

   SECTION("reaching an enum inside a container or an optional") {
      REQUIRE(sidecar.enums.contains("/history"));
      REQUIRE(sidecar.enums.contains("/maybe"));
   }

   SECTION("leaving a plain enum alone, since Glaze writes its number either way") {
      REQUIRE(!sidecar.enums.contains("/plain"));
   }

   SECTION("supplying the pairing the JSON Schema itself cannot") {
      // Glaze renders a named enum as a string with a oneOf of names, so the
      // schema body knows every name and not one of the numbers on the wire.
      auto defs = schema_members<Stateful>().at("$defs").str;
      REQUIRE(defs.contains("retired"));
      REQUIRE(!defs.contains(R"("10")"));
   }
}

TEST_CASE("tracer_codec: A schema for a scalar root records no order") {
   SECTION("because a non-struct root has no keys that untagged could strip") {
      REQUIRE(!schema_members<int>().contains("x-beve-order"));
      REQUIRE(!schema_members<std::string>().contains("x-beve-order"));
      REQUIRE(parse_sidecar(TracerCodec<int>::encode_schema()).order.empty());
   }

   SECTION("carrying a bare enum's names at the whole-document pointer") {
      auto sidecar = parse_sidecar(TracerCodec<Status>::encode_schema());
      REQUIRE(sidecar.order.empty());
      REQUIRE(sidecar.enums.at("").at("10") == "retired");
   }
}

TEST_CASE("tracer_codec: A value survives an encode/decode round trip") {
   SECTION("for a flat struct") {
      REQUIRE(TracerCodec<Flat>::decode(TracerCodec<Flat>::encode(flat)) == flat);
   }

   SECTION("for a struct holding enums") {
      REQUIRE(TracerCodec<Stateful>::decode(TracerCodec<Stateful>::encode(stateful)) == stateful);
   }

   SECTION("for the bare string that Reg<std::string> traces today") {
      std::string const value{"a value"};
      REQUIRE(TracerCodec<std::string>::decode(TracerCodec<std::string>::encode(value)) == value);
   }

   SECTION("for a naked primitive root") {
      REQUIRE(TracerCodec<int>::decode(TracerCodec<int>::encode(-42)) == -42);
   }

   SECTION("for a naked enum root") {
      REQUIRE(TracerCodec<Status>::decode(TracerCodec<Status>::encode(Status::retired)) ==
              Status::retired);
   }
}

TEST_CASE("tracer_codec: Encoding a struct omits its field names") {
   auto untagged = TracerCodec<Flat>::encode(flat);

   SECTION("making the record smaller than the tagged form") {
      std::string tagged{};
      REQUIRE(!glz::write_beve(flat, tagged));
      REQUIRE(untagged.size() < tagged.size());
   }

   SECTION("leaving the struct rendered as a bare array") {
      std::string json{};
      REQUIRE(!glz::beve_to_json(untagged, json));
      REQUIRE(json.starts_with('['));
   }
}

TEST_CASE("tracer_codec: Reinterpreting untagged data reproduces tagged JSON") {
   SECTION("for a flat struct") { REQUIRE(reinterpreted(flat) == tagged_json(flat)); }

   SECTION("for a struct holding a named enum") {
      // The defect this schema format exists to fix: the enumerator has to come
      // back as "active", not as the 2 that is actually on the wire.
      REQUIRE(reinterpreted(stateful).contains(R"("status":"active")"));
      REQUIRE(reinterpreted(stateful) == tagged_json(stateful));
   }

   SECTION("for a disengaged optional") {
      Stateful empty = stateful;
      empty.maybe = std::nullopt;
      empty.history.clear();
      REQUIRE(reinterpreted(empty) == tagged_json(empty));
   }

   SECTION("for a bare enum root") {
      REQUIRE(reinterpreted(Status::retired) == tagged_json(Status::retired));
   }

   SECTION("for a naked primitive root") {
      REQUIRE(reinterpreted(int{-42}) == tagged_json(int{-42}));
      REQUIRE(reinterpreted(std::string{"bare"}) == tagged_json(std::string{"bare"}));
   }

   SECTION("for an unsigned value beyond double precision") {
      Wide const wide{.big = std::numeric_limits<uint64_t>::max(), .single = 1.0f};
      REQUIRE(reinterpreted(wide) == tagged_json(wide));
   }

   SECTION("for a single-precision float") {
      Wide const wide{.big = 0, .single = 0.1f};
      REQUIRE(reinterpreted(wide) == tagged_json(wide));
   }
}

TEST_CASE("tracer_codec: Data that disagrees with its schema is rejected") {
   SECTION("throwing when the payload is not the shape the schema describes") {
      // Flat's four fields read through Wide's two-field schema.
      auto wide_schema = parse_sidecar(TracerCodec<Wide>::encode_schema());
      REQUIRE_THROWS_AS(reinterpret_to_json(wide_schema, TracerCodec<Flat>::encode(flat)),
                        SimulationException);
   }

   SECTION("throwing when the payload is not BEVE at all") {
      auto flat_schema = parse_sidecar(TracerCodec<Flat>::encode_schema());
      REQUIRE_THROWS_AS(reinterpret_to_json(flat_schema, "not beve"), SimulationException);
   }

   SECTION("leaving an unrecognized enumerator as a number, so a stale schema shows") {
      TraceSidecar stale{.order = {"value"}, .enums = {{"/value", {{"1", "pending"}}}}};
      std::string bytes{};
      REQUIRE(!glz::write_beve_untagged(Holder{.value = 99}, bytes));
      REQUIRE(reinterpret_to_json(stale, bytes) == R"({"value":99})");
   }
}

TEST_CASE("tracer_codec: Only flat types are traceable") {
   // A compile-time contract, so there is nothing to run: a nested struct has
   // no positional contract that x-beve-order could record.
   STATIC_REQUIRE(Traceable<Flat>);
   STATIC_REQUIRE(Traceable<Stateful>);
   STATIC_REQUIRE(Traceable<int>);
   STATIC_REQUIRE(Traceable<Status>);
   STATIC_REQUIRE(Traceable<std::string>);
   STATIC_REQUIRE(!Traceable<Nested>);
   STATIC_REQUIRE(!Traceable<std::vector<Flat>>);
}
