#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "tracer.h"
#include "tracer_codec.h"

namespace framework {

   /// @brief One entry of a trace file's signal table, indexed by signal id.
   struct TraceSignal {
      std::string name{};
      uint32_t schema_id{};

      bool operator==(TraceSignal const&) const = default;
   };

   /// @brief The decoded contents of a trace file's header document.
   struct TraceFileHeader {
      uint32_t version{};
      /// @brief Schema sidecar JSON, opaque data
      std::vector<std::string> schemas{};
      /// @brief Indexed by signal id.
      std::vector<TraceSignal> signals{};

      bool operator==(TraceFileHeader const&) const = default;
   };

   /**
    * Trace sink that writes traced values to a file.
    *
    *     0..7    magic "ARCHTRC\0"
    *     8..11   u32   format version
    *     12..15  u32   flags (reserved)
    *     16..23  u64   header length in bytes
    *     24..    header document, BEVE-encoded `TraceFileHeader`
    *     ...     body records, as documented on `TraceSink`
    *     end-16  u64   body length in bytes
    *     end-8   magic "ARCHEND\0"
    */
   class FileTraceSink : public TraceSink {
   public:
      static constexpr std::string_view file_magic = "ARCHTRC";
      static constexpr std::string_view end_magic = "ARCHEND";
      static constexpr uint32_t format_version = 1;

      /// @brief Byte offset at which the header document starts.
      static constexpr std::streamoff header_offset = 24;
      /// @brief Size of the trailer written by `commit_file_end()`.
      static constexpr std::streamoff trailer_size = 16;

      /// @throws SimulationException if the file cannot be opened for writing.
      explicit FileTraceSink(std::filesystem::path const& filename);

      /// @brief Finalizes the file if `commit_file_end()` was never called.
      ~FileTraceSink() override;

      void commit_header() override;
      void commit_body_data(std::string_view data) override;
      void commit_file_end() override;

   private:
      void write_raw(void const* data, std::size_t size);

      std::ofstream m_file;
      std::filesystem::path m_path;
      uint64_t m_body_bytes = 0;
      bool m_finalized = false;
   };

} // namespace framework
