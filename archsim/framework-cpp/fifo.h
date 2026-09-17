#pragma once

#include <cassert>
#include <optional>

#include "simulation.h"

namespace framework {

   /**
    * Synchronous circular FIFO with a depth of Size entries.
    * Writes and reads are staged during a cycle and committed on tick().
    */
   template <typename T, size_t Size>
   class Fifo : public Entity {
   public:
      Fifo() { static_assert(Size > 0, "Fifo size must be greater than 0"); }

      bool can_write() const { return !m_next_write_data.has_value() && m_count < Size; }
      bool can_read() const { return m_count > 0; }

      /**
       * Stages data to be pushed on the next tick(). Requires can_write().
       */
      void assign_write(T data) {
         assert(can_write());
         m_write_detector.add_and_check_driver("fifo_write");
         m_next_write_data = data;
      }

      /**
       * Returns the entry at the head of the FIFO and stages the pop, which is
       * committed on the next tick(). Requires can_read().
       */
      T read() {
         assert(can_read());
         m_next_read_staged = true;
         return m_buffer[m_read_index];
      }

   protected:
      void on_tick() override {
         // Handle any reads pending
         if (m_next_read_staged) {
            m_read_index = (m_read_index + 1) % Size;
            m_count--;
         }

         // Handle any writes pending
         if (m_next_write_data.has_value()) {
            m_buffer[m_write_index] = *m_next_write_data;
            m_write_index = (m_write_index + 1) % Size;
            m_count++;
         }
      }

      void on_after_tick() override {
         m_next_write_data.reset();
         m_next_read_staged = false;
         m_write_detector.reset();
      }

   private:
      T m_buffer[std::max(1UL, Size - 1)];
      int m_write_index = 0;
      int m_read_index = 0;
      int m_count = 0;
      std::optional<T> m_next_write_data{};
      bool m_next_read_staged = false;
      MultiDriverDetector m_write_detector{*this};
   };

} // namespace framework
