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
      explicit Reg(EntityConfig config, T initial_value)
            : Entity{config},
              m_initial_value{initial_value},
              m_value{initial_value},
              m_tracer{config, ""} {
         on_reset();
      }

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
      void on_tick() override {
         if (m_next_value.has_value()) {
            if (m_next_value.value() != m_value) {
               m_tracer.on_value_change(m_next_value.value());
            }
            m_value = m_next_value.value();
         }
      }

      void on_after_tick() override {
         m_next_value.reset();
         m_detector.reset();
      }

      void on_reset() override {
         m_next_value.reset();
         m_value = m_initial_value;
         m_detector.reset();
      }

   private:
      MultiDriverDetector m_detector{*this};
      const T m_initial_value;
      T m_value;
      std::optional<T> m_next_value{};
      Tracer<T> m_tracer;
   };

} // namespace framework
