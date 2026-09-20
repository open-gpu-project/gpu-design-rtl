#pragma once

#include <logpp/logpp.h>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <typeindex>
#include <typeinfo>
#include <unordered_map>
#include <vector>

#include "exceptions.h"
#include "simulation.h"
#include "tracer_codec.h"

namespace framework {

   class TraceSink;
   class TracerBase;

   /// @brief Signal identifier to quickly reference a registered signal
   struct signal_id_t {
      friend class TraceSink;

      bool operator==(signal_id_t const&) const = default;

      /// @brief The signal's index, as written into every value-change record.
      unsigned index() const { return value; }

      /// @brief Hash functor, for using an entity id as an unordered container key.
      struct hash {
         std::size_t operator()(signal_id_t id) const { return std::hash<unsigned>{}(id.value); }
      };

   private:
      signal_id_t(unsigned v) : value(v) {}
      unsigned value;
   };

   /**
    * Sink for recording traced values and their schemas. It converts the
    * traced values into an internal representation. These can then be committed
    * into a file (whichever format you wish to serialize into).
    *
    * The body is a flat stream of 8-byte records. This is the one part of a
    * trace that is not BEVE: a reader must be able to skip a value it does not
    * care about, and BEVE offers no public "how many bytes did that value take"
    * API, so each value record carries its own payload length.
    *
    *    tick record:  bit 63 set,   bits 62..0  = tick
    *    value record: bit 63 clear, bits 62..32 = signal id
    *                                bits 31..0  = payload length in bytes,
    *                  followed by that many bytes of untagged BEVE
    */
   class TraceSink {
   public:
      virtual ~TraceSink() = default;

      void write_value_change(signal_id_t, std::string_view data);
      void write_tick(unsigned tick);

      void register_schema(std::type_info const&, std::string_view data);
      signal_id_t register_signal(std::type_info const&, std::string name);

      virtual void commit_header() {}
      virtual void commit_body_data(std::string_view) {}
      virtual void commit_file_end() {}

      /// @brief Number of bytes in a body record header.
      static constexpr std::size_t record_header_size = sizeof(uint64_t);

   protected:
      using schema_id_t = uint32_t;
      using signal_name_t = std::string;
      using schema_data_t = std::string;

      /// @brief Serialized schemas, indexed by schema id.
      std::vector<schema_data_t> const& schemas() const { return m_schemas; }

      /// @brief Registered signals, indexed by signal id.
      std::vector<std::pair<signal_name_t, schema_id_t>> const& signals() const {
         return m_signals;
      }

   private:
      std::unordered_map<std::type_index, schema_id_t> m_schema_ids{};
      std::vector<schema_data_t> m_schemas{};
      std::vector<std::pair<signal_name_t, schema_id_t>> m_signals{};

      // Scratch buffer for composing a record, so each record reaches
      // commit_body_data() as a single call.
      std::string m_record{};
   };

   /// @brief Base class for tracers that record changes in values over time.
   class TracerBase {
   public:
      explicit TracerBase(EntityConfig const& config)
            : m_simulation{config.simulation}, m_entity_id{config.id} {
         m_simulation.register_tracer(*this);
      }

      virtual ~TracerBase() = default;

      // Set the sink for recording traced values. Called by Simulation::build(),
      // once every entity has its fully qualified name.
      virtual void initialize(TraceSink* sink) = 0;

      // Reset the tracer to its initial state.
      virtual void reset() = 0;

   protected:
      /// @brief The signal name to register, qualified by the owning entity's path.
      std::string qualified_name(std::string_view local_name) const {
         auto name = m_simulation.get_entity_full_name(m_entity_id);
         if (!local_name.empty()) {
            name += '.';
            name += local_name;
         }
         return name;
      }

      Simulation& m_simulation;
      entity_id_t m_entity_id;
   };

   /**
    * Tracer class that records changes in values of type T over time. Value
    * changes are streamed to the `TraceSink` the simulation was built with.
    */
   template <typename T>
   class Tracer : public TracerBase {
   public:
      Tracer(EntityConfig const& config, std::string_view name)
            : TracerBase{config}, m_name{name} {}

      void initialize(TraceSink* sink) override {
         m_sink = sink;
         if (m_sink == nullptr) {
            return;
         }
         m_sink->register_schema(typeid(T), TracerCodec<T>::encode_schema());
         m_signal_id = m_sink->register_signal(typeid(T), qualified_name(m_name));
      }

      virtual void on_value_change(T const& value) {
         if (!m_sink || !m_signal_id) {
            return;
         }
         m_sink->write_value_change(*m_signal_id, TracerCodec<T>::encode(value));
      }

      void reset() override {}

   private:
      const std::string m_name;
      TraceSink* m_sink = nullptr;
      std::optional<signal_id_t> m_signal_id = std::nullopt;
   };

} // namespace framework
