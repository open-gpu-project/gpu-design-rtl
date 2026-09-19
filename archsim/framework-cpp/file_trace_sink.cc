#include "file_trace_sink.h"

#include <glaze/beve.hpp>

#include "exceptions.h"

using namespace framework;

FileTraceSink::FileTraceSink(std::filesystem::path const& filename) : m_path{filename} {
   m_file.open(filename, std::ios::out | std::ios::binary | std::ios::trunc);
   if (!m_file.is_open()) {
      throw GenericSimulationException("Could not open trace file for writing",
                                       std::pair{"path", filename.string()});
   }
}

FileTraceSink::~FileTraceSink() {
   // In case the file is still open, we should commit and close it
   try {
      commit_file_end();
   } catch (...) {
      // A destructor must not throw
   }
}

void FileTraceSink::write_raw(void const* data, std::size_t size) {
   m_file.write(static_cast<char const*>(data), static_cast<std::streamsize>(size));
}

void FileTraceSink::commit_header() {
   TraceFileHeader header{.version = format_version};
   header.schemas.assign(schemas().begin(), schemas().end());
   header.signals.reserve(signals().size());
   for (auto const& [name, schema_id] : signals()) {
      header.signals.push_back(TraceSignal{.name = name, .schema_id = schema_id});
   }

   std::string document{};
   if (auto ec = glz::write_beve(header, document); ec) {
      throw GenericSimulationException("Failed to encode the trace file header",
                                       std::pair{"reason", glz::format_error(ec)});
   }

   const uint32_t version = format_version;
   const uint32_t flags = 0;
   const uint64_t length = document.size();

   write_raw(file_magic.data(), file_magic.size());
   write_raw("\0", 1);
   write_raw(&version, sizeof(version));
   write_raw(&flags, sizeof(flags));
   write_raw(&length, sizeof(length));
   write_raw(document.data(), document.size());
}

void FileTraceSink::commit_body_data(std::string_view data) {
   write_raw(data.data(), data.size());
   m_body_bytes += data.size();
}

void FileTraceSink::commit_file_end() {
   if (m_finalized || !m_file.is_open()) {
      return;
   }
   m_finalized = true;

   write_raw(&m_body_bytes, sizeof(m_body_bytes));
   write_raw(end_magic.data(), end_magic.size());
   write_raw("\0", 1);
   m_file.flush();
   m_file.close();
}
