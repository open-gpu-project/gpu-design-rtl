#pragma once

#include <logpp/logpp.h>

#include <cpptrace/cpptrace.hpp>
#include <exception>
#include <memory>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>

namespace framework {

   namespace detail {

      template<typename T>
      inline constexpr bool is_log_field_v = false;

      template<typename Key, typename Value>
      inline constexpr bool is_log_field_v<logpp::LogField<Key, Value>> = true;

      template<typename T>
      inline constexpr bool is_log_field_tuple_v = false;

      // An empty tuple is a (degenerate) tuple of fields, so the fold's identity is
      // the correct answer here.
      template<typename... Ts>
      inline constexpr bool is_log_field_tuple_v<std::tuple<Ts...>> =
            (is_log_field_v<std::remove_cvref_t<Ts>> && ...);

   } // namespace detail

   /// Satisfied by any `logpp::LogField<Key, Value>`, whatever its key/value types.
   template<typename T>
   concept LogField = detail::is_log_field_v<std::remove_cvref_t<T>>;

   /// Satisfied by a `std::tuple` holding any number of `LogField`s of any type.
   template<typename T>
   concept LogFieldTuple = detail::is_log_field_tuple_v<std::remove_cvref_t<T>>;

} // namespace framework
