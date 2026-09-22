#include "tracer.h"

#include <bit>
#include <limits>

#include "exceptions.h"

using namespace framework;

namespace {

   /// @brief Set on a tick record, clear on a value record.
   constexpr uint64_t tick_flag = 1ULL << 63;

   /// @brief Signal ids occupy bits 62..32, so bit 63 stays free for the flag.
   constexpr uint64_t max_signal_id = (1ULL << 31) - 1;

   // Record headers are written as raw native words and BEVE is little-endian,
   // so a trace is only portable if the two agree.
   static_assert(std::endian::native == std::endian::little,
                 "Trace records are written as native little-endian words");

} // namespace

void TraceSink::write_value_change(signal_id_t signal_id, std::string_view data, tag_t tag) {
   if (data.size() > std::numeric_limits<uint32_t>::max()) {
      throw GenericSimulationException("Traced value is too large to record",
                                       std::pair{"signal_id", signal_id.index()},
                                       std::pair{"bytes", static_cast<uint64_t>(data.size())});
   }

   // Signal id in the high half, payload length in the low half, so a reader
   // can skip to the next record without parsing the BEVE payload.
   uint64_t header = (static_cast<uint64_t>(signal_id.index()) << 32) | data.size();
   // TODO(claude): tag is not plumbed through here
   (void) tag;
   m_record.assign(reinterpret_cast<char const*>(&header), sizeof(header));
   m_record.append(data);
   commit_body_data(m_record);
}

void TraceSink::write_tick(unsigned tick) {
   uint64_t header = tick | tick_flag;
   m_record.assign(reinterpret_cast<char const*>(&header), sizeof(header));
   commit_body_data(m_record);
}

void TraceSink::register_schema(std::type_info const& type, std::string_view data) {
   auto [it, inserted] = m_schema_ids.try_emplace(std::type_index(type),
                                                  static_cast<schema_id_t>(m_schemas.size()));
   if (inserted) {
      m_schemas.emplace_back(data);
   }
}

signal_id_t TraceSink::register_signal(std::type_info const& type, std::string name) {
   auto it = m_schema_ids.find(std::type_index(type));
   if (it == m_schema_ids.end()) {
      throw GenericSimulationException("Schema not registered for this type",
                                       std::pair{"type", std::string{type.name()}},
                                       std::pair{"name", name});
   }
   if (m_signals.size() > max_signal_id) {
      throw GenericSimulationException("Too many registered signals",
                                       std::pair{"limit", max_signal_id});
   }
   auto id = static_cast<unsigned>(m_signals.size());
   m_signals.emplace_back(std::move(name), it->second);
   return signal_id_t(id);
}
