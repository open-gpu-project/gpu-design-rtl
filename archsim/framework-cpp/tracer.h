#pragma once

#include <logpp/logpp.h>

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

#include "simulation.h"
#include "tracer_codec.h"
#include "tracer_sink.h"

namespace framework {

   /// @brief Base class for tracers that record changes in values over time.
   class TracerBase {
   public:
      /**
       * @param name
       * The local name of the entity within the simulation. If empty, the
       * entity's full name will be used instead. Otherwise, the full name of the
       * signal is `<entity_full_name>.<local_name>`
       */
      explicit TracerBase(EntityConfig const& config,
                          std::string_view name,
                          std::string_view description,
                          bool enabled = true);

      virtual ~TracerBase() = default;

      // Set the sink for recording traced values. Called by Simulation::build(),
      // once every entity has its fully qualified name.
      virtual void initialize(TracerSink* sink) {
         if (m_enabled) m_sink = sink;
      }

      // Reset the tracer to its initial state.
      virtual void reset() = 0;

   protected:
      /// @brief The signal name to register, qualified by the owning entity's path.
      std::string qualified_name() const {
         auto name = m_simulation.get_entity_full_name(m_entity_id);
         if (!m_local_name.empty()) {
            name += '.';
            name += m_local_name;
         }
         return name;
      }

      /// @brief Wraps m_sink's write_value_change method.
      void write_value_change(signal_id_t signal_id,
                              tag_t tag = default_tag,
                              std::string_view payload = "");

   protected:
      const entity_id_t m_entity_id;
      const std::string m_local_name;
      const bool m_enabled;

   private:
      Simulation& m_simulation;
      TracerSink* m_sink = nullptr;
   };

   /**
    * Tracer class that records changes in values of type T over time. Value
    * changes are streamed to the `TracerSink` the simulation was built with.
    */
   template <typename T>
   class Tracer : public TracerBase {
   public:
      Tracer(EntityConfig const& config,
             std::string_view name = "",
             std::string_view description = "",
             bool enabled = true)
            : TracerBase{config, name, description, enabled} {}

      void initialize(TracerSink* sink) override {
         if (!sink) return;
         TracerBase::initialize(sink);
         sink->register_schema(typeid(T), TracerCodec<T>::encode_schema());
         m_signal_id = sink->register_signal(typeid(T), qualified_name());
      }

      virtual void record(T const& value, tag_t tag = default_tag) {
         if (!m_signal_id) return;
         write_value_change(*m_signal_id, tag, TracerCodec<T>::encode(value));
      }

      void reset() override {}

   private:
      std::optional<signal_id_t> m_signal_id = std::nullopt;
   };

   /**
    * Tracer for data-less events only. TODO(claude): Implement.
    */
   class EventTracer : public TracerBase {
   public:
      EventTracer(EntityConfig const& config,
                  std::string_view name = "",
                  std::string_view description = "",
                  bool enabled = true)
            : TracerBase{config, name, description, enabled} {}
      void initialize(TracerSink* sink) override;
      virtual void record(tag_t tag = default_tag);
      void reset() override {}

   private:
      std::optional<signal_id_t> m_signal_id = std::nullopt;
   };

} // namespace framework
