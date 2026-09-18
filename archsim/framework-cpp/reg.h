#pragma once

#include "simulation.h"
#include "tracer.h"

namespace framework {

   /**
    * Register primitive that holds a value and supports synchronous updates.
    */
   template <std::equality_comparable T>
   class Reg : public Entity {
   public:
      explicit Reg(EntityConfig config, T initial_value) : Entity{config}, m_value{initial_value} {}

      /**
       * Assigns a value to the register that will take effect on the next clock tick.
       */
      void assign(T value) {
         m_detector.add_and_check_driver("reg_assign");
         m_next_value = value;
      }

      /**
       * Returns the current value of the register.
       */
      T const& value() const { return m_value; }

   protected:
      void on_tick(Simulation const& context) override {
         if (m_next_value.has_value()) {
            m_value = m_next_value.value();
            if (m_next_value.value() != m_value) {
               tracer.on_value_change(context.current_tick(), m_value);
            }
         }
      }

      void on_after_tick(Simulation const&) override {
         m_next_value.reset();
         m_detector.reset();
      }

   private:
      MultiDriverDetector m_detector{*this};
      T m_value;
      std::optional<T> m_next_value{};
      Tracer<T> tracer{"reg"};
   };

} // namespace framework
