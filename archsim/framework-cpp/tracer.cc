#include "tracer.h"

#include "simulation.h"

using namespace framework;

TracerBase::TracerBase(EntityConfig const& config,
                       std::string_view name,
                       std::string_view description,
                       bool enabled)
      : m_entity_id{config.id},
        m_local_name{name},
        m_enabled{enabled},
        m_simulation{config.simulation} {
   // FIXME(claude): Use the description for the tracer.
   (void)description;
   if (enabled) {
      m_simulation.register_tracer(*this);
   }
}

void TracerBase::write_value_change(signal_id_t signal_id, tag_t tag, std::string_view payload) {
   if (m_sink != nullptr) {
      m_sink->write_value_change(signal_id, tag, payload);
   }
}

void EventTracer::initialize(TracerSink* sink) {
   if (!sink) return;
   TracerBase::initialize(sink);
   sink->register_schema(typeid(void));
   m_signal_id = sink->register_signal(typeid(void), qualified_name());
}

void EventTracer::record(tag_t tag) {
   if (!m_signal_id) return;
   write_value_change(*m_signal_id, tag);
}
