#pragma once

#include "simulation.h"

namespace framework {

   /**
    * Register primitive that holds a value and supports synchronous updates.
    */
   template <typename T>
   class Reg : public Entity {
   public:
      explicit Reg(T initial_value) : m_value{initial_value} {}

      /**
       * Assigns a value to the register that will take effect on the next clock tick.
       */
      void assign(T value) {
         m_detector.add_and_check_driver("reg_assign");
         m_next_value = value;
      }

   protected:
      void on_tick() override {
         if (m_next_value.has_value()) {
            m_value = m_next_value.value();
         }
      }

      void on_after_tick() override {
         m_next_value.reset();
         m_detector.reset();
      }

   private:
      MultiDriverDetector m_detector{*this};
      T m_value;
      std::optional<T> m_next_value{};
   };

} // namespace framework
