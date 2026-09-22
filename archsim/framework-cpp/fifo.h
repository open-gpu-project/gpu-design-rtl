#pragma once

#include <cassert>
#include <optional>

#include "simulation.h"
#include "tracer.h"

namespace framework {

   /**
    * Synchronous circular FIFO with a depth of Size entries.
    * Writes and reads are staged during a cycle and committed on tick().
    */
   template <typename T, uint16_t Size>
   class Fifo : public Entity {
   public:
      Fifo(EntityConfig config)
            : Entity{config},
              m_write_tracer{config, "write", "Tracks write data for each write operation"},
              m_read_tracer{config, "read", "Tracks queue size before each read operation"} {
         static_assert(Size > 0, "Fifo size must be greater than 0");
         on_reset();
      }

      bool can_write() const { return !m_next_write_data.has_value() && m_count < Size; }
      bool can_read() const { return m_count > 0; }

      /**
       * Stages data to be pushed on the next tick(). Requires can_write().
       */
      void assign_write(T data, tag_t tag = default_tag) {
         assert(can_write());
         m_write_detector.add_and_check_driver("fifo_write");
         m_next_write_data = std::make_pair(data, tag);
      }

      /**
       * Returns the entry at the head of the FIFO and stages the pop, which is
       * committed on the next tick(). Requires can_read().
       */
      std::pair<T, tag_t> read() {
         assert(can_read());
         m_next_read_staged = true;
         return m_buffer[m_read_index];
      }

      /**
       * Returns the entry at the head of the FIFO without staging a pop.
       * Returns std::nullopt if the FIFO is empty.
       */
      std::optional<T> peek() const {
         return m_count > 0 ? m_buffer[m_read_index].first : std::nullopt;
      }

   protected:
      void on_tick() override {
         // Handle any reads pending
         if (m_next_read_staged) {
            const auto tag = m_buffer[m_read_index].second;
            m_read_tracer.on_value_change(m_count, tag);
            m_read_index = (m_read_index + 1) % Size;
            m_count--;
         }

         // Handle any writes pending
         if (m_next_write_data.has_value()) {
            auto const& [data, tag] = m_next_write_data.value();
            m_write_tracer.on_value_change(data, tag);
            m_buffer[m_write_index] = std::make_pair(data, tag);
            m_write_index = (m_write_index + 1) % Size;
            m_count++;
         }
      }

      void on_after_tick() override {
         m_next_write_data.reset();
         m_next_read_staged = false;
         m_write_detector.reset();
      }

      void on_reset() override {
         m_write_index = 0;
         m_read_index = 0;
         m_count = 0;
         m_next_write_data.reset();
         m_next_read_staged = false;
         m_write_detector.reset();
         m_write_tracer.reset();
         m_read_tracer.reset();
      }

   private:
      std::pair<T, tag_t> m_buffer[Size];
      int m_write_index = 0;
      int m_read_index = 0;
      int m_count = 0;
      std::optional<std::pair<T, tag_t>> m_next_write_data{};
      bool m_next_read_staged = false;
      MultiDriverDetector m_write_detector{*this};
      Tracer<T> m_write_tracer;
      Tracer<uint16_t> m_read_tracer;
   };

} // namespace framework
