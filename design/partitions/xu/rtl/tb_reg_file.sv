`timescale 1ns/1ps

module tb_reg_file;

    logic clk;
    logic rst;

    logic [9:0]  addr_a;
    logic        en_a;
    logic        we_a;
    logic [35:0] wdata_a;
    logic [35:0] rdata_a;

    logic [9:0]  addr_b;
    logic        en_b;
    logic        we_b;
    logic [35:0] wdata_b;
    logic [35:0] rdata_b;

    reg_file dut (
        .clk    (clk),
        .rst    (rst),

        .addr_a (addr_a),
        .en_a   (en_a),
        .we_a   (we_a),
        .wdata_a(wdata_a),
        .rdata_a(rdata_a),

        .addr_b (addr_b),
        .en_b   (en_b),
        .we_b   (we_b),
        .wdata_b(wdata_b),
        .rdata_b(rdata_b)
    );

    // clock: 10 ns period
    initial clk = 0;
    always #5 clk = ~clk;

    initial begin
        $dumpfile("tb_reg_file.vcd");
        $dumpvars(0, tb_reg_file);

        #100

        // init
        rst     = 1;

        addr_a  = 0;
        en_a    = 0;
        we_a    = 0;
        wdata_a = 0;

        addr_b  = 0;
        en_b    = 0;
        we_b    = 0;
        wdata_b = 0;

        // reset for 2 cycles
        repeat (2) @(posedge clk);
        rst = 0;

        // -------------------------
        // Test 1: write on port A
        // -------------------------
        @(posedge clk);
        en_a    <= 1;
        we_a    <= 1;
        addr_a  <= 10'd3;
        wdata_a <= 36'h00000ABCD;

        // stop write, prepare read
        @(posedge clk);
        we_a    <= 0;
        addr_a  <= 10'd3;

        // wait for synchronous read
        @(posedge clk);
        @(posedge clk);

        $display("Read A addr 3 = %h", rdata_a);

        if (rdata_a !== 36'h00000ABCD) begin
            $display("TEST 1 FAILED");
            $finish;
        end else begin
            $display("TEST 1 PASSED");
        end

        // -------------------------
        // Test 2: write on port B
        // -------------------------
        @(posedge clk);
        en_b    <= 1;
        we_b    <= 1;
        addr_b  <= 10'd7;
        wdata_b <= 36'h000001234;

        @(posedge clk);
        we_b    <= 0;
        addr_b  <= 10'd7;

        @(posedge clk);
        @(posedge clk);

        $display("Read B addr 7 = %h", rdata_b);

        if (rdata_b !== 36'h000001234) begin
            $display("TEST 2 FAILED");
            $finish;
        end else begin
            $display("TEST 2 PASSED");
        end

        // -------------------------
        // Test 3: both ports
        // -------------------------
        @(posedge clk);
        en_a    <= 1;
        we_a    <= 1;
        addr_a  <= 10'd10;
        wdata_a <= 36'h00000AAAA;

        en_b    <= 1;
        we_b    <= 1;
        addr_b  <= 10'd11;
        wdata_b <= 36'h00000BBBB;

        @(posedge clk);
        we_a    <= 0;
        we_b    <= 0;
        addr_a  <= 10'd10;
        addr_b  <= 10'd11;

        @(posedge clk);
        @(posedge clk);

        $display("Read A addr 10 = %h", rdata_a);
        $display("Read B addr 11 = %h", rdata_b);

        if (rdata_a !== 36'h00000AAAA || rdata_b !== 36'h00000BBBB) begin
            $display("TEST 3 FAILED");
            $finish;
        end else begin
            $display("TEST 3 PASSED");
        end

        $display("ALL TESTS PASSED");
        $finish;
    end

endmodule