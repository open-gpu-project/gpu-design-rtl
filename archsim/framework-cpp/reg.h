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
              m_value{initial_value, default_tag},
              m_tracer{config, "", "Tracks value changes for the register"} {
         on_reset();
      }

      /**
       * Assigns a value to the register that will take effect on the next clock tick.
       */
      void assign(T value, tag_t tag = default_tag) {
         m_detector.add_and_check_driver("reg_assign");
         m_next_value = std::make_pair(value, tag);
      }

      /**
       * Returns the current value of the register.
       */
      T const& value() const { return m_value.first; }

   protected:
      void on_tick() override {
         if (m_next_value.has_value()) {
            auto [next_value, next_tag] = m_next_value.value();
            if (next_value != m_value.first) {
               m_tracer.on_value_change(next_value, next_tag);
            }
            m_value = std::make_pair(next_value, next_tag);
         }
      }

      void on_after_tick() override {
         m_next_value.reset();
         m_detector.reset();
      }

      void on_reset() override {
         m_next_value.reset();
         m_value = std::make_pair(m_initial_value, default_tag);
         m_detector.reset();
      }

   private:
      MultiDriverDetector m_detector{*this};
      const T m_initial_value;
      std::pair<T, tag_t> m_value;
      std::optional<std::pair<T, tag_t>> m_next_value{};
      Tracer<T> m_tracer;
   };

} // namespace framework
