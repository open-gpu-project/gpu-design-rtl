#pragma once

#include <cassert>
#include <cpptrace/cpptrace.hpp>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "concepts.h"
#include "simulation_settings.h"

namespace framework {

   class Simulation;
   class Entity;
   class TracerBase;
   class TracerSink;

   using tag_t = uint32_t;
   static tag_t default_tag = 0;

   /**
    * Represents a clock signal in the simulation, identified by its period and
    * phase. The clock's rising edge falls on every tick where
    * `tick % period == phase`. See also `Simulation::set_clock_name()`.
    */
   class Clock {
   public:
      Clock(unsigned period, unsigned phase)
            : m_packed(static_cast<uint64_t>(period) << 32 | static_cast<uint64_t>(phase)) {
         assert(period > 0 && "Clock period must be positive");
         assert(phase < period && "Clock phase must be in [0, period)");
      }
      bool rising_edge(unsigned cycle) const {
         unsigned period = static_cast<unsigned>(m_packed >> 32);
         unsigned phase = static_cast<unsigned>(m_packed & 0xFFFFFFFF);
         return cycle % period == phase;
      }
      bool operator==(const Clock& other) const { return m_packed == other.m_packed; }
      struct hash {
         std::size_t operator()(const Clock& clk) const noexcept {
            return std::hash<uint64_t>{}(clk.m_packed);
         }
      };

   private:
      const uint64_t m_packed;
   };

   /**
    * Opaque handle to an entity registered with the simulation. Only the
    * simulation that issued it can resolve it back to an `Entity`.
    */
   DECLARE_ID_TYPE(entity_id_t, Simulation, unsigned);

   template <typename T>
   using EntityRef = std::pair<entity_id_t, T&>;

   /**
    * Configuration for a simulation entity, assigned by `Simulation` when
    * registering the entity.
    */
   struct EntityConfig {
      Simulation& simulation;
      Clock clock;
      entity_id_t id;
      std::string name;

      template <typename T, typename... Args>
         requires std::is_base_of_v<Entity, T>
      EntityRef<T> add_child(std::string_view name, Args&&... args);
   };

   /**
    * Represents a simulation entity that reacts to clock ticks and can be evaluated.
    * Entities are expected to be driven by the `Simulation` class.
    */
   class Entity {
      friend class Simulation;

   public:
      explicit Entity(EntityConfig config) : m_config(config) {}
      virtual ~Entity() = default;

      /**
       * Read-only access to the entity's configuration.
       */
      EntityConfig const& config() const { return m_config; }

      /**
       * Adds a child entity to this entity. The child is constructed with the
       * provided arguments and registered with the simulation.
       */
      template <typename T, typename... Args>
         requires std::is_base_of_v<Entity, T>
      EntityRef<T> add_child(std::string_view name, Args&&... args);

      SimulationSettings const& settings() const;

   protected:
      /**
       * Called to evaluate the entity's combinational state graphs before
       * `on_tick()` is called on the clock edge. Ordering of evaluation
       * relative to other entities is not guaranteed.
       */
      virtual void on_evaluate() {}

      /**
       * Called on the rising edge of the clock. This is when any staged updates
       * or assignments should be applied to the entity's state and made available
       * for the next cycle.
       *
       * Ordering of tick updates relative to other entities is not guaranteed.
       */
      virtual void on_tick() {}

      /**
       * Called to reset the tick state after `on_tick()` is called. Any staged
       * updates or assignments should be cleared.
       */
      virtual void on_after_tick() {}

      /**
       * Called when the simulation is reset. Any state should be restored to its
       * initial value. The simulation's tick count is already reset by the time
       * this is called.
       */
      virtual void on_reset() {}

   private:
      EntityConfig m_config;
   };

   /**
    * Represents the top-level simulation that manages and drives all entities
    * based on their clocks. Contains the main simulation loop driver.
    */
   class Simulation {
   public:
      explicit Simulation(TracerSink* sink = nullptr, SimulationSettings settings = {})
            : m_sink(sink), m_settings(std::move(settings)) {}

      std::string_view get_clock_name(Clock clock) const { return m_clock_to_name.at(clock); }
      void set_clock_name(std::string_view name, Clock clock) {
         m_clock_to_name.insert_or_assign(clock, std::string{name});
      }

      /**
       * Adds a new synchronous hardware entity to the simulation whose tick is
       * driven by the specified clock.
       */
      template <typename T, typename... Args>
         requires std::is_base_of_v<Entity, T>
      EntityRef<T> add_entity(std::string_view name,
                              Clock clock,
                              std::optional<entity_id_t> parent,
                              Args&&... args) {
         auto entity_id = entity_id_t{static_cast<unsigned>(m_entities.size())};
         m_entities.push_back(nullptr);
         auto entity_ptr = std::make_unique<T>(
               EntityConfig{
                     .simulation = *this,
                     .clock = clock,
                     .id = entity_id,
                     // name is computed in the next step
                     .name = {},
               },
               std::forward<Args>(args)...);
         auto& entity = add_entity_impl(entity_id, name, std::move(entity_ptr), parent);
         return {entity_id, static_cast<T&>(entity)};
      }

      /// @brief Builds the simulation, preparing it for execution.
      void build();

      /// @brief Registers a tracer with the simulation.
      void register_tracer(TracerBase& tracer);

      /// @brief Run the simulation for the specified number of cycles. A
      ///        `SimulationException` is logged and ends the run early, but is
      ///        not propagated to the caller unless `throw_on_exception` is set.
      void run(int cycles, bool throw_on_exception = false);

      /// @brief Reset the simulation to its initial state.
      void reset();

      /// @brief Stops the simulation.
      void stop();

      /// @brief Gets the current simulation tick count
      auto current_tick() const { return m_cycle_count; }

      /// @brief Gets the fully qualified name of the entity
      std::string get_entity_full_name(entity_id_t id) const;

      /// @brief Gets the parent entity of the specified entity, if it exists.
      std::optional<entity_id_t> get_entity_parent(entity_id_t id) const;

      /// @brief Sets the parent entity for a given tag. If the tag already has
      //         a parent, it will be overwritten.
      void set_tag_parent(tag_t tag, entity_id_t parent);

      /**
       * Dumps a text-based representation of the entity tree and tracers
       * @param os The output stream to which the tree and tracers will be dumped.
       */
      void dump_tree(std::ostream& os) const;

      SimulationSettings const& settings() const { return m_settings; }

   private:
      void run_one_tick();

   private:
      Entity& add_entity_impl(entity_id_t entity_id,
                              std::string_view name,
                              std::unique_ptr<Entity> entity,
                              std::optional<entity_id_t> parent);

      std::unordered_map<Clock, std::string, Clock::hash> m_clock_to_name{};
      std::vector<std::unique_ptr<Entity>> m_entities{};
      std::unordered_map<entity_id_t, std::string, entity_id_t::hash> m_entity_names{};
      std::unordered_map<entity_id_t, entity_id_t, entity_id_t::hash> m_entity_tree{};
      std::unordered_map<std::string, entity_id_t> m_name_to_entity{};
      std::vector<TracerBase*> m_tracers{};
      unsigned m_cycle_count{0};
      bool built = false;
      TracerSink* m_sink = nullptr;
      SimulationSettings m_settings{};
   };

   /**
    * Detects multiple drivers for a single signal. Throws a `MultiDriverException`
    * if more than one driver is detected.
    */
   class MultiDriverDetector {
   public:
      MultiDriverDetector(Entity& owner) : m_owner{owner} {}

      /**
       * Adds a driver and checks for multiple drivers.
       *
       * Throwing does not disarm the detector: it stays armed until `reset()`,
       * so every extra driver in the cycle is reported, and the first driver of
       * the cycle is always the one reported as `previous`.
       *
       * @param signal_name The name of the signal being driven.
       * @throws MultiDriverException if more than one driver is detected.
       */
      void add_and_check_driver(std::string_view signal_name);

      /**
       * Resets the driver detection, usually called inside `on_after_tick()`
       */
      void reset() { m_caller.reset(); }

   private:
      std::optional<cpptrace::stacktrace> m_caller{};
      [[maybe_unused]]
      Entity& m_owner;
   };

   template <typename T, typename... Args>
      requires std::is_base_of_v<Entity, T>
   EntityRef<T> EntityConfig::add_child(std::string_view name, Args&&... args) {
      return simulation.add_entity<T>(name, clock, id, std::forward<Args>(args)...);
   }

   template <typename T, typename... Args>
      requires std::is_base_of_v<Entity, T>
   EntityRef<T> Entity::add_child(std::string_view name, Args&&... args) {
      return m_config.add_child<T>(name, std::forward<Args>(args)...);
   }

} // namespace framework
