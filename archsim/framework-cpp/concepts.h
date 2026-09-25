#pragma once

#include <logpp/logpp.h>

#include <cpptrace/cpptrace.hpp>
#include <tuple>
#include <type_traits>

namespace framework {

   namespace detail {

      template <typename T>
      inline constexpr bool is_log_field_v = false;

      template <typename Key, typename Value>
      inline constexpr bool is_log_field_v<logpp::LogField<Key, Value>> = true;

      template <typename T>
      inline constexpr bool is_log_field_tuple_v = false;

      // An empty tuple is a (degenerate) tuple of fields, so the fold's identity is
      // the correct answer here.
      template <typename... Ts>
      inline constexpr bool is_log_field_tuple_v<std::tuple<Ts...>> =
            (is_log_field_v<std::remove_cvref_t<Ts>> && ...);

      /// True iff `T` is one of the element types of the tuple `Tuple`.
      template <typename T, typename Tuple>
      inline constexpr bool tuple_contains_v = false;

      template <typename T, typename... Us>
      inline constexpr bool tuple_contains_v<T, std::tuple<Us...>> = (std::is_same_v<T, Us> || ...);

      /// True iff no type appears twice in `Ts...`. The empty and one-element
      /// packs are trivially distinct, which is what the primary template gives.
      template <typename... Ts>
      inline constexpr bool all_distinct_v = true;

      template <typename T, typename... Rest>
      inline constexpr bool all_distinct_v<T, Rest...> =
            (!std::is_same_v<T, Rest> && ...) && all_distinct_v<Rest...>;

      /// True iff `Ts...` is a genuine subset of `Tuple`'s elements -- every one
      /// of them is an element, and none is repeated. Order is irrelevant.
      template <typename Tuple, typename... Ts>
      inline constexpr bool is_tuple_subset_v =
            all_distinct_v<Ts...> && (tuple_contains_v<Ts, Tuple> && ...);

      /// The unpacking form of `is_tuple_subset_v`: true iff `T` is itself a
      /// `std::tuple` whose elements are a genuine subset of `Tuple`'s. Lets a
      /// caller name a result tuple type instead of spelling out its elements.
      template <typename Tuple, typename T>
      inline constexpr bool is_tuple_subset_of_v = false;

      template <typename Tuple, typename... Ts>
      inline constexpr bool is_tuple_subset_of_v<Tuple, std::tuple<Ts...>> =
            is_tuple_subset_v<Tuple, Ts...>;

   } // namespace detail

   /// Satisfied by any `logpp::LogField<Key, Value>`, whatever its key/value types.
   template <typename T>
   concept LogField = detail::is_log_field_v<std::remove_cvref_t<T>>;

   /// Satisfied by a `std::tuple` holding any number of `LogField`s of any type.
   template <typename T>
   concept LogFieldTuple = detail::is_log_field_tuple_v<std::remove_cvref_t<T>>;

} // namespace framework

/**
 * Declares a strongly-typed ID type with a specified underlying type.
 *
 * @param Name The name of the new ID type.
 * @param FriendName The class that is allowed to construct instances of this ID type.
 * @param UnderlyingType The underlying type used to store the ID value.
 */
#define DECLARE_ID_TYPE(Name, FriendName, UnderlyingType)                       \
   struct Name {                                                                \
   public:                                                                      \
      bool operator==(const Name& other) const { return value == other.value; } \
      struct hash {                                                             \
         std::size_t operator()(const Name& id) const noexcept {                \
            return std::hash<UnderlyingType>{}(id.value);                       \
         }                                                                      \
      };                                                                        \
                                                                                \
   private:                                                                     \
      friend class FriendName;                                                  \
      explicit Name(UnderlyingType id) : value{id} {}                           \
      UnderlyingType value;                                                     \
   };
