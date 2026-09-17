#include "simulation.h"

#include <cpptrace/cpptrace.hpp>

#include "exceptions.h"

using namespace framework;

Simulation::clock_id_t Simulation::add_clock(std::string_view name, int period, int phase) {
   unsigned next_id = static_cast<unsigned>(m_clocks.size());
   m_clocks.emplace(next_id, Clock{name, period, phase});
   return clock_id_t{next_id};
}

Entity& Simulation::add_entity(std::unique_ptr<Entity>&& entity, clock_id_t clock_id) {
   auto& clock = get_clock(clock_id);
   entity.get()->m_config.emplace(EntityConfig{
         .clock = clock,
   });
   m_entities.emplace_back(std::move(entity));
   return *(m_entities.back());
}

void Simulation::run(int cycles) {
   int cycle = 0;
   try {
      for (; cycle < cycles; ++cycle) {
         run_one_tick();
      }
   } catch (SimulationException& e) {
      e.log();
   }
}

void Simulation::run_one_tick() {
   // Tick all the clocks
   for (auto& [id, clock] : m_clocks) {
      clock.tick();
   }

   // Evaluate all entities
   for (auto& entity : m_entities) {
      if (entity->config().clock.rising_edge()) {
         entity->on_evaluate();
      }
   }

   // Tick all entities on the rising edge of their clock
   for (auto& entity : m_entities) {
      if (entity->config().clock.rising_edge()) {
         entity->on_tick();
         entity->on_after_tick();
      }
   }
}

void MultiDriverDetector::add_and_check_driver(std::string_view signal_name) {
   auto st = std::make_unique<cpptrace::stacktrace>(cpptrace::stacktrace::current());
   if (m_caller != nullptr) {
      throw MultiDriverException(signal_name, std::move(m_caller), std::move(st));
   } else {
      m_caller = std::move(st);
   }
}
