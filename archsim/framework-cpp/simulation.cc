#include "simulation.h"

#include <logpp/logpp.h>

#include <cpptrace/cpptrace.hpp>
#include <utility>

#include "exceptions.h"
#include "tracer.h"

using namespace framework;

clock_id_t Simulation::add_clock(std::string_view name, int period, int phase) {
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

Entity& Simulation::add_entity_impl(entity_id_t entity_id,
                                    std::string_view name,
                                    std::unique_ptr<Entity> entity,
                                    std::optional<entity_id_t> parent) {
   // Check the parent exists and is in the simulation, if specified
   if (parent.has_value() && parent.value().value >= m_entities.size()) {
      throw GenericSimulationException("Parent entity does not belong to this simulation",
                                       std::pair{"entity_name", std::string{name}});
   }
   if (parent.has_value()) {
      m_entity_tree.insert_or_assign(entity_id, parent.value());
   }
   m_entity_names.insert_or_assign(entity_id, std::string{name});
   m_entities[entity_id.value] = std::move(entity);
   return *m_entities[entity_id.value];
}

void Simulation::build() {
   if (built) return;
   // Build name_to_entity mapping for all entities
   m_name_to_entity.clear();
   for (const auto& [entity_id, name] : m_entity_names) {
      auto full_name = get_entity_full_name(entity_id);
      if (m_name_to_entity.find(full_name) != m_name_to_entity.end()) {
         throw GenericSimulationException("Duplicate entity path",
                                          std::pair{"entity_path", full_name});
      }
      auto& entity = m_entities.at(entity_id.value);
      entity->m_config.name = full_name;
      m_name_to_entity.insert_or_assign(full_name, entity_id);
   }
   // We can now initialize the tracer
   if (m_sink) {
      for (auto* tracer : m_tracers) {
         tracer->initialize(m_sink);
      }
      m_sink->commit_header();
   } else if (!m_tracers.empty()) {
      logpp::warn("Simulation has tracers but no sink, so nothing will be recorded",
                  logpp::field("tracers", static_cast<uint64_t>(m_tracers.size())));
   }
   built = true;
}

void Simulation::register_tracer(TracerBase& tracer) {
   if (built) {
      throw GenericSimulationException("Cannot register a tracer after the simulation is built");
   }
   m_tracers.push_back(&tracer);
}

void Simulation::run(int cycles) {
   build();
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

   if (m_sink) {
      m_sink->write_tick(m_cycle_count);
   }

   // Tick all the clocks
   for (auto& clock : m_clocks) {
      clock.tick();
   }

   // Evaluate all entities' combinational logic
   for (auto& entity : m_entities) {
      entity->on_evaluate();
   }

   // Commit all registered writes on this clock edge
   for (auto& entity : m_entities) {
      if (entity->config().clock.rising_edge()) {
         entity->on_tick();
      }
      entity->on_after_tick();
   }
}

void Simulation::reset() {
   m_cycle_count = 0;
   for (auto& clock : m_clocks) {
      clock.reset();
   }
   for (auto* tracer : m_tracers) {
      tracer->reset();
   }

   // Reset entities last, so they observe a tick count of zero. Registration
   // (names and hierarchy) deliberately survives a reset.
   for (auto& entity : m_entities) {
      entity->on_reset();
   }
}

void Simulation::stop() {
   if (m_sink) {
      m_sink->commit_file_end();
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

std::optional<entity_id_t> Simulation::get_entity_parent(entity_id_t id) const {
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
