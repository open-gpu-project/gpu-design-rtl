#include "tracer_sink.h"

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

void TracerSink::write_value_change(signal_id_t signal_id, tag_t tag, std::string_view data) {
   // Check if signal id is in range and schema is correct
   if(signal_id.value >= m_signals.size()) {
      throw GenericSimulationException("Signal id out of range",
                                       std::pair{"signal_id", signal_id.value});
   }
   const auto schema_id = m_signals[signal_id.value].second;
   if(schema_id >= m_schemas.size()) {
      throw GenericSimulationException("Schema id out of range",
                                       std::pair{"schema_id", schema_id});
   }

   // Is this an event? If so, ignore the given `data`.
   const bool is_event = !m_schemas[schema_id].has_value();
   const uint32_t payload_length = is_event ? 0 : static_cast<uint32_t>(data.size());

   // Check if the data is too large
   if (!is_event && data.size() > std::numeric_limits<uint32_t>::max()) {
      throw GenericSimulationException("Traced value is too large to record",
                                       std::pair{"signal_id", signal_id.value},
                                       std::pair{"bytes", static_cast<uint64_t>(data.size())});
   }

   // Signal id in the high half, payload length in the low half, so a reader
   // can skip to the next record without parsing the BEVE payload.
   uint64_t header = (static_cast<uint64_t>(signal_id.value) << 32) | payload_length;
   // TODO(claude): tag is not plumbed through here
   (void)tag;
   m_record.assign(reinterpret_cast<char const*>(&header), sizeof(header));
   if(!is_event)
      m_record.append(data);
   commit_body_data(m_record);
}

void TracerSink::write_tick(unsigned tick) {
   uint64_t header = tick | tick_flag;
   m_record.assign(reinterpret_cast<char const*>(&header), sizeof(header));
   commit_body_data(m_record);
}

void TracerSink::register_schema(std::type_info const& type, std::string_view data) {
   auto [it, inserted] = m_schema_ids.try_emplace(std::type_index(type),
                                                  static_cast<schema_id_t>(m_schemas.size()));
   if (inserted) {
      if(type == typeid(void)) {
         m_schemas.emplace_back(std::nullopt);
      } else {
         m_schemas.emplace_back(std::string(data));
      }
   }
}

signal_id_t TracerSink::register_signal(std::type_info const& type, std::string name) {
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
   auto id = static_cast<signal_id_t>(m_signals.size());
   m_signals.emplace_back(std::move(name), it->second);
   return id;
}
