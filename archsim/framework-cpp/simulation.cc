#include "simulation.h"

#include <logpp/logpp.h>

#include <cpptrace/cpptrace.hpp>
#include <utility>

#include "exceptions.h"

using namespace framework;

Simulation::clock_id_t Simulation::add_clock(std::string_view name, int period, int phase) {
   // Validate the period first, so the phase message is never nonsense
   if (period <= 0) {
      throw GenericSimulationException("Clock period must be positive",
                                       std::pair{"clock", std::string{name}},
                                       std::pair{"period", period});
   }
   if (phase < 0 || phase >= period) {
      throw GenericSimulationException("Clock phase must be in [0, period)",
                                       std::pair{"clock", std::string{name}},
                                       std::pair{"phase", phase},
                                       std::pair{"period", period});
   }

   unsigned next_id = static_cast<unsigned>(m_clocks.size());
   m_clocks.emplace_back(Clock{name, period, phase});
   return clock_id_t{next_id};
}

Simulation::entity_id_t Simulation::add_entity(std::string_view name,
                                               std::unique_ptr<Entity> entity,
                                               clock_id_t clock_id,
                                               std::optional<entity_id_t> parent) {
   // Compute the entity's ID. Note this does not consume the ID: if registration
   // is rejected below, the next entity added will be given the same one.
   auto entity_id = entity_id_t{static_cast<unsigned>(m_entities.size())};

   // Resolve the clock first, so a bad clock ID throws before anything is mutated
   auto& clock = get_clock(clock_id);

   if (parent.has_value() && parent.value().value >= m_entities.size()) {
      throw GenericSimulationException("Parent entity does not belong to this simulation",
                                       std::pair{"entity_name", std::string{name}});
   }

   // Compute the entity's fully qualified path by walking up the parent chain.
   // This must not touch `m_entity_tree` -- see the commit point below.
   auto full_name = parent.has_value()
                          ? get_entity_full_name(parent.value()) + "." + std::string{name}
                          : std::string{name};

   if (m_name_to_entity.contains(full_name)) {
      throw GenericSimulationException("Entity name must be unique",
                                       std::pair{"entity_path", full_name});
   }

   // --- Commit point: every check has passed, so nothing below may throw. A
   // partial commit would leak state onto an ID that a later entity reuses.
   entity->m_config.emplace(EntityConfig{
         .clock = clock,
   });
   if (parent.has_value()) {
      m_entity_tree.insert_or_assign(entity_id, parent.value());
   }
   // The local name, not the full path: `get_entity_full_name()` joins the chain
   m_entity_names.insert_or_assign(entity_id, std::string{name});
   m_name_to_entity.insert_or_assign(full_name, entity_id);
   m_entities.emplace_back(std::move(entity));

   // Log a message
   logpp::info("Registered entity with simulation", logpp::field("entity_path", full_name));

   return entity_id;
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
   // Tick the context
   m_cycle_count++;

   // Tick all the clocks
   for (auto& clock : m_clocks) {
      clock.tick();
   }

   // Evaluate all entities' combinational logic
   for (auto& entity : m_entities) {
      entity->on_evaluate(*this);
   }

   // Commit all registered writes on this clock edge
   for (auto& entity : m_entities) {
      if (entity->config().clock.rising_edge()) {
         entity->on_tick(*this);
      }
      entity->on_after_tick(*this);
   }
}

void Simulation::reset() {
   m_cycle_count = 0;
   for (auto& clock : m_clocks) {
      clock.reset();
   }

   // Reset entities last, so they observe a tick count of zero. Registration
   // (names and hierarchy) deliberately survives a reset.
   for (auto& entity : m_entities) {
      entity->on_reset(*this);
   }
}

std::string Simulation::get_entity_full_name(entity_id_t id) const {
   std::string full_name;
   auto parent_it = m_entity_tree.find(id);
   if (parent_it == m_entity_tree.end()) {
      return m_entity_names.at(id);
   }
   auto& parent_id = parent_it->second;
   return get_entity_full_name(parent_id) + "." + m_entity_names.at(id);
}

std::optional<Simulation::entity_id_t> Simulation::get_entity_parent(entity_id_t id) const {
   auto it = m_entity_tree.find(id);
   if (it != m_entity_tree.end()) {
      return it->second;
   }
   return std::nullopt;
}

void MultiDriverDetector::add_and_check_driver(std::string_view signal_name) {
   auto st = cpptrace::stacktrace::current();
   if (m_caller.has_value()) {
      // The stash deliberately survives the throw: it stays armed until
      // reset(), so every extra driver this cycle is reported against the
      // first one rather than silently re-arming the detector.
      throw MultiDriverException(signal_name, *m_caller, st);
   }
   m_caller = std::move(st);
}
