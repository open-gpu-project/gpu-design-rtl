/**
 * This file contains the unit tests for file_trace_sink.cc/h
 *
 * Registration and record framing are covered by test_tracer.cc against a
 * mock sink; what is tested here is only what reaching a real file adds --
 * the envelope, the header document, and finalization.
 */

#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <glaze/beve.hpp>
#include <string>
#include <vector>

#include "framework-cpp/exceptions.h"
#include "framework-cpp/file_trace_sink.h"
#include "framework-cpp/simulation.h"
#include "trace_records.h"

// Glaze reflects on this, so it needs linkage.
namespace sink_test {

   using namespace framework;

   struct Sample {
      int32_t count;
      std::string label;

      bool operator==(Sample const&) const = default;
   };

   /// @brief Entity that owns a tracer and drives it on demand.
   struct Probe : Entity {
      explicit Probe(EntityConfig config) : Entity{config}, tracer{config, ""} {}

      Tracer<Sample> tracer;
   };

   /// @brief A unique path under the temp directory, removed on scope exit.
   class TempPath {
   public:
      explicit TempPath(std::string_view name)
            : m_path{std::filesystem::temp_directory_path() / name} {
         std::filesystem::remove(m_path);
      }
      ~TempPath() { std::filesystem::remove(m_path); }

      std::filesystem::path const& get() const { return m_path; }

   private:
      std::filesystem::path m_path;
   };

   std::string read_file(std::filesystem::path const& path) {
      std::ifstream file{path, std::ios::in | std::ios::binary};
      return std::string{std::istreambuf_iterator<char>{file}, std::istreambuf_iterator<char>{}};
   }

   template <typename T>
   T read_at(std::string_view bytes, std::size_t offset) {
      T value{};
      REQUIRE(offset + sizeof(T) <= bytes.size());
      std::memcpy(&value, bytes.data() + offset, sizeof(T));
      return value;
   }

   /// @brief The header document's byte range, per the envelope.
   std::string_view header_bytes(std::string_view file) {
      auto length = read_at<uint64_t>(file, 16);
      return file.substr(FileTraceSink::header_offset, length);
   }

   /// @brief The body's byte range: between the header and the trailer.
   std::string_view body_bytes(std::string_view file) {
      auto start = FileTraceSink::header_offset + read_at<uint64_t>(file, 16);
      auto end = file.size() - FileTraceSink::trailer_size;
      return file.substr(start, end - start);
   }

   Sample const first{.count = 3, .label = "alpha"};
   Sample const second{.count = -1, .label = "beta"};

   /// @brief Writes a two-record trace and returns the file's bytes.
   std::string write_sample_trace(std::filesystem::path const& path) {
      {
         FileTraceSink sink{path};
         Simulation sim{&sink};
         auto clk = sim.add_clock("clk");
         auto [id, probe] = sim.add_entity<Probe>("dut", clk, std::nullopt);
         sim.build();
         probe.tracer.on_value_change(first);
         probe.tracer.on_value_change(second);
         sim.stop();
      }
      return read_file(path);
   }

} // namespace sink_test

using namespace sink_test;

TEST_CASE("file_trace_sink: A trace file carries a recognizable envelope") {
   TempPath path{"archsim_trace_envelope.beve"};
   auto file = write_sample_trace(path.get());

   SECTION("opening with the magic and format version") {
      REQUIRE(file.starts_with(FileTraceSink::file_magic));
      REQUIRE(read_at<uint32_t>(file, 8) == FileTraceSink::format_version);
   }

   SECTION("declaring a header length that lands on the body") {
      REQUIRE(read_at<uint64_t>(file, 16) > 0);
      REQUIRE(FileTraceSink::header_offset + read_at<uint64_t>(file, 16) <
              file.size() - FileTraceSink::trailer_size);
   }

   SECTION("closing with the body length and the trailer magic") {
      auto trailer = file.size() - FileTraceSink::trailer_size;
      REQUIRE(read_at<uint64_t>(file, trailer) == body_bytes(file).size());
      REQUIRE(file.substr(trailer + 8).starts_with(FileTraceSink::end_magic));
   }
}

TEST_CASE("file_trace_sink: A trace file header describes every signal") {
   TempPath path{"archsim_trace_header.beve"};
   auto file = write_sample_trace(path.get());

   TraceFileHeader header{};
   REQUIRE(!glz::read_beve(header, header_bytes(file)));

   SECTION("recording the format version") { REQUIRE(header.version == 1); }

   SECTION("indexing signals by signal id") {
      REQUIRE(header.signals.size() == 1);
      REQUIRE(header.signals[0].name == "dut");
      REQUIRE(header.signals[0].schema_id == 0);
   }

   SECTION("indexing schemas by schema id") {
      REQUIRE(header.schemas.size() == 1);
      REQUIRE(header.schemas.at(header.signals[0].schema_id) ==
              TracerCodec<Sample>::encode_schema());
   }
}

TEST_CASE("file_trace_sink: A trace file is readable without the program that wrote it") {
   TempPath path{"archsim_trace_readback.beve"};
   auto file = write_sample_trace(path.get());

   TraceFileHeader header{};
   REQUIRE(!glz::read_beve(header, header_bytes(file)));
   auto records = trace_test::value_records(body_bytes(file));

   SECTION("recovering every value by pairing the body with the header's schema") {
      REQUIRE(records.size() == 2);
      std::vector<std::string> recovered{};
      for (auto const& record : records) {
         auto const& schema = header.schemas.at(header.signals.at(record.signal_id).schema_id);
         recovered.push_back(reinterpret_to_json(parse_sidecar(schema), record.payload));
      }
      REQUIRE(recovered == std::vector<std::string>{R"({"count":3,"label":"alpha"})",
                                                    R"({"count":-1,"label":"beta"})"});
   }
}

TEST_CASE("file_trace_sink: A path that cannot be opened fails loudly") {
   SECTION("throwing rather than silently discarding every write") {
      auto missing = std::filesystem::temp_directory_path() / "archsim_no_such_dir" / "t.beve";
      REQUIRE_THROWS_AS(FileTraceSink{missing}, SimulationException);
   }
}

TEST_CASE("file_trace_sink: Destroying the sink finalizes the file") {
   TempPath path{"archsim_trace_unstopped.beve"};
   {
      FileTraceSink sink{path.get()};
      sink.commit_header();
   }

   SECTION("writing the trailer even though nothing called stop()") {
      REQUIRE(read_file(path.get()).ends_with(std::string{FileTraceSink::end_magic} + '\0'));
   }
}
