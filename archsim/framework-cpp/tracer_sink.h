#pragma once

#include <logpp/logpp.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <typeindex>
#include <typeinfo>
#include <unordered_map>
#include <vector>

#include "simulation.h"

namespace framework {
   class TracerSink;

   /// @brief Signal identifier to quickly reference a registered signal
   DECLARE_ID_TYPE(signal_id_t, TracerSink, unsigned);

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
   class TracerSink {
   public:
      virtual ~TracerSink() = default;

      void write_value_change(signal_id_t, tag_t tag = default_tag, std::string_view data = "");
      void write_tick(unsigned tick);

      void register_schema(std::type_info const&, std::string_view data = "");
      signal_id_t register_signal(std::type_info const&, std::string name);

      virtual void commit_header() {}
      virtual void commit_body_data(std::string_view) {}
      virtual void commit_file_end() {}

      /// @brief Number of bytes in a body record header.
      static constexpr std::size_t record_header_size = sizeof(uint64_t);

   protected:
      using schema_id_t = uint32_t;
      using signal_name_t = std::string;
      using schema_data_t = std::optional<std::string>;

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
} // namespace framework
