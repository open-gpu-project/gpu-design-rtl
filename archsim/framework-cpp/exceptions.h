#pragma once

#include <logpp/logpp.h>

#include <cpptrace/cpptrace.hpp>
#include <exception>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>

#include "concepts.h"

namespace framework {
   namespace detail {
      template <typename T>
      concept StructuredExceptionType = requires(const T& t) {
         { t.get_fields() } -> LogFieldTuple;
      };
   } // namespace detail

   /**
    * Base handler to allow catch-alls for all simulation-related exceptions.
    */
   class SimulationException : public std::exception {
   public:
      explicit SimulationException(std::string_view what) : m_what{what} {}
      const char* what() const noexcept override { return m_what.c_str(); }
      virtual void log() const {
         logpp::error("Simulation error occurred", logpp::field("details", m_what));
      }

   private:
      std::string m_what;
   };

   /**
    * SFINAE base for exceptions that want to provide structured logging fields.
    */
   template <typename T>
   class StructuredSimulationException : public SimulationException {
   public:
      explicit StructuredSimulationException(std::string_view what) : SimulationException(what) {}

      void log() const override {
         static_assert(detail::StructuredExceptionType<T>,
                       "A simulation exception must provide `get_fields() const` returning a "
                       "std::tuple of logpp::LogField<> (use logpp::field(key, value))");
         std::apply(
               [this](const auto&... fields) {
                  logpp::error(
                        "Simulation error occurred", logpp::field("details", what()), fields...);
               },
               static_cast<const T&>(*this).get_fields());
      }
   };

   /**
    * Generic simulation exception holding arbitrary structured logging fields.
    */
   template <typename... Ts>
   class GenericSimulationException
         : public StructuredSimulationException<GenericSimulationException<Ts...>> {
   public:
      template <typename... Ks>
      GenericSimulationException(std::string_view what, std::pair<Ks, Ts>... fields)
            : StructuredSimulationException<GenericSimulationException<Ts...>>(what),
              m_fields{std::pair<std::string, Ts>{std::move(fields.first),
                                                  std::move(fields.second)}...} {}

      auto get_fields() const {
         return std::apply(
               [](const auto&... fields) {
                  return std::make_tuple(logpp::field(fields.first, fields.second)...);
               },
               m_fields);
      }

   private:
      std::tuple<std::pair<std::string, Ts>...> m_fields;
   };

   /**
    * Multiple drivers detected. The exception contains the location of each
    * driver's stack trace (including the current one).
    */
   class MultiDriverException : public StructuredSimulationException<MultiDriverException> {
   public:
      MultiDriverException(std::string_view driver_name,
                           cpptrace::stacktrace const& previous,
                           cpptrace::stacktrace const& current)
            : StructuredSimulationException<MultiDriverException>(
                    "Multiple drivers detected for signal"),
              m_driver_name(driver_name),
              m_previous_trace(previous.to_string()),
              m_current_trace(current.to_string()) {}

      auto get_fields() const {
         return std::make_tuple(logpp::field("signal", m_driver_name),
                                logpp::field("previous", m_previous_trace),
                                logpp::field("current", m_current_trace));
      }

   private:
      std::string m_driver_name;
      std::string m_previous_trace;
      std::string m_current_trace;
   };

} // namespace framework
