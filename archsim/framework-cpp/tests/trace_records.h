#pragma once

#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "framework-cpp/tracer.h"

namespace trace_test {

   /// @brief One decoded body record. See `framework::TraceSink` for the layout.
   struct Record {
      bool is_tick{};
      unsigned tick{};
      unsigned signal_id{};
      std::string payload{};
   };

   /**
    * Walks a body stream into records.
    *
    * Shared by the tracer and file-sink tests so that the framing is described
    * in exactly one place: a second copy would quietly rot the moment the
    * record layout changed.
    */
   inline std::vector<Record> parse_records(std::string_view body) {
      constexpr uint64_t tick_flag = 1ULL << 63;
      std::vector<Record> records{};
      std::size_t offset = 0;
      while (offset + framework::TraceSink::record_header_size <= body.size()) {
         uint64_t header = 0;
         std::memcpy(&header, body.data() + offset, sizeof(header));
         offset += sizeof(header);

         if ((header & tick_flag) != 0) {
            records.push_back(Record{.is_tick = true, .tick = unsigned(header & ~tick_flag)});
            continue;
         }
         auto length = static_cast<std::size_t>(header & 0xFFFF'FFFFULL);
         records.push_back(Record{.is_tick = false,
                                  .signal_id = unsigned(header >> 32),
                                  .payload = std::string{body.substr(offset, length)}});
         offset += length;
      }
      return records;
   }

   /// @brief The value records only, in order.
   inline std::vector<Record> value_records(std::string_view body) {
      std::vector<Record> out{};
      for (auto& record : parse_records(body)) {
         if (!record.is_tick) {
            out.push_back(std::move(record));
         }
      }
      return out;
   }

} // namespace trace_test
