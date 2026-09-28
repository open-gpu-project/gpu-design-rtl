#pragma once

#include <bitset>
#include <tuple>
#include <type_traits>
#include <utility>

#include "concepts.h"
#include "fifo.h"
#include "simulation.h"

namespace framework::axi3 {

   enum class BurstType : uint8_t { Fixed = 0, Incr = 1, Wrap = 2 };

   /**
    * All non-handshake signals for the AR channel
    */
   struct ArChannelData {
      std::bitset<6> arid;
      std::bitset<32> araddr;
      std::bitset<8> arlen;
      std::bitset<3> arsize;
      BurstType arburst;
   };

   /**
    * All non-handshake signals for the R channel
    */
   struct RChannelData {
      std::bitset<6> rid;
      std::bitset<32> rdata;
      std::bitset<4> rstrb;
      std::bitset<1> rlast;
   };

   /**
    * All non-handshake signals for the AW channel
    */
   struct AwChannelData {
      std::bitset<6> awid;
      std::bitset<32> awaddr;
      std::bitset<8> awlen;
      std::bitset<3> awsize;
      BurstType awburst;
   };

   /**
    * All non-handshake signals for the W channel
    */
   struct WChannelData {
      std::bitset<6> wid;
      std::bitset<32> wdata;
      std::bitset<4> wstrb;
      std::bitset<1> wlast;
   };

   /**
    * Concept constraining T to be one of the struct types above.
    */
   template <typename T>
   concept ChannelData = std::is_same_v<T, ArChannelData> || std::is_same_v<T, RChannelData> ||
                         std::is_same_v<T, AwChannelData> || std::is_same_v<T, WChannelData>;

   /**
    * AXI3 Channel Entity, basically a wrapper around a 2-deep Fifo. Cannot
    * be interacted unless split into its Source and Sink views respectively.
    */
   template <ChannelData T>
   struct Channel;

   /**
    * Source view of Channel<T>, required to interact with the channel.
    */
   template <ChannelData T>
   struct ChannelSource;

   /**
    * Sink view of Channel<T>, required to interact with the channel.
    */
   template <ChannelData T>
   struct ChannelSink;

   template <ChannelData T>
   struct ChannelSink {
   public:
      bool ready() const { return m_fifo.can_write(); }
      void write(T data, tag_t tag = default_tag) { m_fifo.assign_write(data, tag); }
      void write(std::pair<T, tag_t> tagged) { m_fifo.assign_write(tagged); }

   private:
      friend struct Channel<T>;
      ChannelSink(Fifo<T, 2>& fifo) : m_fifo{fifo} {}
      Fifo<T, 2>& m_fifo;
   };

   template <ChannelData T>
   struct ChannelSource {
   public:
      bool valid() const { return m_fifo.can_read(); }
      std::pair<T, tag_t> read() {
         if (m_fifo.settings().enable_axi3_checks) {
            check_value_if_valid();
         }
         return m_fifo.read();
      }
      std::optional<std::pair<T, tag_t>> peek() const { return m_fifo.peek(); }
      std::optional<T> peek_data() const { return m_fifo.peek_data(); }
      void check_value_if_valid() const;

   private:
      friend struct Channel<T>;
      ChannelSource(Fifo<T, 2>& fifo) : m_fifo{fifo} {}
      Fifo<T, 2>& m_fifo;
   };

   template <ChannelData T>
   struct Channel : public Fifo<T, 2> {
   public:
      Channel(EntityConfig config)
            : Fifo<T, 2>{config, false},
              m_tracer{config, "", "Traces any latched valid data on interface's output port"} {}

      std::tuple<ChannelSource<T>, ChannelSink<T>> split() {
         return {ChannelSource<T>(*this), ChannelSink<T>(*this)};
      }

   protected:
      virtual void on_tick() override {
         Fifo<T, 2>::on_tick();
         // We only care about recording the data presented at the head of the FIFO
         // that *may or may not* be read in the next cycle.
         auto peeked = this->peek();
         if (peeked.has_value()) {
            m_tracer.record((*peeked).first, (*peeked).second);
         }
      }
      virtual void on_reset() override {
         Fifo<T, 2>::on_reset();
         m_tracer.reset();
      }

   private:
      Tracer<T> m_tracer;
   };

   using ArChannel = Channel<ArChannelData>;
   using ArChannelSource = ChannelSource<ArChannelData>;
   using ArChannelSink = ChannelSink<ArChannelData>;
   using RChannel = Channel<RChannelData>;
   using RChannelSource = ChannelSource<RChannelData>;
   using RChannelSink = ChannelSink<RChannelData>;
   using AwChannel = Channel<AwChannelData>;
   using AwChannelSource = ChannelSource<AwChannelData>;
   using AwChannelSink = ChannelSink<AwChannelData>;
   using WChannel = Channel<WChannelData>;
   using WChannelSource = ChannelSource<WChannelData>;
   using WChannelSink = ChannelSink<WChannelData>;

   // Master AXI3 port named in SystemVerilog modport convention
   using MasterInterface = std::tuple< //
         ArChannelSource,              //
         AwChannelSource,
         WChannelSource,
         RChannelSink>;

   // Slave AXI3 port named in SystemVerilog modport convention
   using SlaveInterface = std::tuple< //
         ArChannelSink,               //
         AwChannelSink,
         WChannelSink,
         RChannelSource>;

   // Satisfied when `Ts...` are distinct element types of `MasterInterface`.
   template <typename... Ts>
   concept MasterSubset = detail::is_tuple_subset_v<MasterInterface, Ts...>;

   // Satisfied when `Ts...` are distinct element types of `SlaveInterface`.
   template <typename... Ts>
   concept SlaveSubset = detail::is_tuple_subset_v<SlaveInterface, Ts...>;

   // Satisfied when `Ts...` names views from exactly one side of the interface.
   template <typename... Ts>
   concept InterfaceSubset = MasterSubset<Ts...> != SlaveSubset<Ts...>;

   // Tuple-typed forms of the three above: satisfied when `T` is a `std::tuple`
   // whose elements satisfy the matching pack concept. These let a caller name a
   // declared interface alias rather than respelling its element types.
   template <typename T>
   concept MasterSubsetTuple = detail::is_tuple_subset_of_v<MasterInterface, T>;

   template <typename T>
   concept SlaveSubsetTuple = detail::is_tuple_subset_of_v<SlaveInterface, T>;

   template <typename T>
   concept InterfaceSubsetTuple = MasterSubsetTuple<T> != SlaveSubsetTuple<T>;

   // Holds the AXI channels and provides a way to get the master/slave interfaces.
   struct AxiInterfaceHolder : Entity {
   public:
      AxiInterfaceHolder(EntityConfig config)
            : Entity{config},
              channels{make_channels(config)},
              interfaces{get_interfaces(channels)} {}

      /**
       * Returns the requested channel views as a tuple, in the order requested.
       * `Ts...` must be mut-ex-subsets of `MasterInterface` or `SlaveInterface`.
       */
      template <typename... Ts>
         requires InterfaceSubset<Ts...>
      std::tuple<Ts...> get() {
         if constexpr (MasterSubset<Ts...>) {
            auto& side = std::get<MasterInterface>(interfaces);
            return {std::get<Ts>(side)...};
         } else {
            auto& side = std::get<SlaveInterface>(interfaces);
            return {std::get<Ts>(side)...};
         }
      }

      /**
       * Same as `get()` except `T` is a tuple type instead of the raw types.
       */
      template <typename T>
         requires InterfaceSubsetTuple<T>
      T get() {
         return get_elements<T>(std::make_index_sequence<std::tuple_size_v<T>>{});
      }

      /**
       * Get a single channel of type T from either the master or slave interface.
       */
      template <typename T>
         requires MasterSubset<T> || SlaveSubset<T>
      T& view() {
         if constexpr (MasterSubset<T>) {
            auto& side = std::get<MasterInterface>(interfaces);
            return std::get<T>(side);
         } else {
            auto& side = std::get<SlaveInterface>(interfaces);
            return std::get<T>(side);
         }
      }

   private:
      // Unpacks `T`'s element types back into the variadic `get()`. The two
      // overloads never compete: a channel view is not a tuple, so exactly one
      // of `InterfaceSubset` and `InterfaceSubsetTuple` can hold for any request.
      template <typename T, std::size_t... Is>
      T get_elements(std::index_sequence<Is...>) {
         return get<std::tuple_element_t<Is, T>...>();
      }

      using ChannelTupleTy = std::tuple<ArChannel&, AwChannel&, WChannel&, RChannel&>;
      using InterfaceTupleTy = std::tuple<MasterInterface, SlaveInterface>;

      ChannelTupleTy channels;
      InterfaceTupleTy interfaces;

      // Helper called by constructor to create the tuple of channel references.
      static ChannelTupleTy make_channels(EntityConfig& config) {
         auto [_1, ar] = config.add_child<ArChannel>("ar");
         auto [_2, aw] = config.add_child<AwChannel>("aw");
         auto [_3, w] = config.add_child<WChannel>("w");
         auto [_4, r] = config.add_child<RChannel>("r");
         return std::tie(ar, aw, w, r);
      }

      // Returns the master and slave interfaces for the AXI channels.
      static InterfaceTupleTy get_interfaces(ChannelTupleTy& channels) {
         auto [aw_source, aw_sink] = std::get<AwChannel&>(channels).split();
         auto [w_source, w_sink] = std::get<WChannel&>(channels).split();
         auto [ar_source, ar_sink] = std::get<ArChannel&>(channels).split();
         auto [r_source, r_sink] = std::get<RChannel&>(channels).split();
         return {{ar_source, aw_source, w_source, r_sink}, {ar_sink, aw_sink, w_sink, r_source}};
      }
   };

} // namespace framework::axi3
