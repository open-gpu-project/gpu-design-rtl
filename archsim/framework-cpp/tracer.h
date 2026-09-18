#pragma once

#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

#include "exceptions.h"

namespace framework {

   class RecorderBase {
   public:
      virtual ~RecorderBase() = default;
      virtual void print() const = 0;
   };

   /**
    * Defines the "recorder" concept, which requires a class to inherit RecorderBase
    * and to have a `record_value_change<T>(T const& value)` method.
    */
   template <typename ClassTy, typename T>
   concept RecordableTrait = requires(ClassTy a, ClassTy const b, T const& value, unsigned tick) {
      { a.record_value_change(tick, value) } -> std::same_as<void>;
   } && std::is_base_of_v<RecorderBase, ClassTy>;

   /**
    * Tracer class that records changes in values of type T over time. It can dump
    * its recorded changes to any recorder that satisfies the RecordableTrait<T>.
    */
   template <typename T>
   class Tracer {
   public:
      Tracer(std::string_view name) : m_name{name} {}

      void dump(RecordableTrait<T> auto& recorder) {
         for (auto [tick, change] : m_changes) {
            recorder.record_value_change(tick, change);
         }
      }

      void on_value_change(unsigned tick, T const& value) {
         if (tick < m_last_tick) {
            throw SimulationException("Tick must be non-decreasing");
         }
         m_last_tick = tick;
         m_changes.emplace_back(tick, value);
      }

      bool equals(Tracer const& other) const { return m_changes == other.m_changes; }

   private:
      const std::string m_name;
      unsigned m_last_tick = 0;
      std::vector<std::pair<unsigned, T>> m_changes;
   };

} // namespace framework
