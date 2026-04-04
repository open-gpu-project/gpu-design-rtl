`timescale 1ns/10ps
`default_nettype none
`include "xu_priv.svh"

module tb_alu;
    logic clk;
    logic rst;

    // logic [29:0] A;
    // logic [17:0] B;
    // logic [47:0] C;
    // logic [24:0] D;
    // xu_priv::dsp_input dsp_data_in;
    // assign dsp_data_in.A = A;
    // assign dsp_data_in.B = B;
    // assign dsp_data_in.C = C;
    // assign dsp_data_in.D = D;

    xu_priv::dsp_ctl l0dsp_control;

    xu_priv::dsp_ctl l1dsp_control;

    xu_priv::dsp_casc_in l1dsp_casc_in;
    assign l1dsp_casc_in.PCIN = '0;
    assign l1dsp_casc_in.MULTSIGNIN = 1'b0;
    assign l1dsp_casc_in.CARRYCASCIN = 1'b0;
 
    xu_priv::dsp_casc_out l0dsp_casc_out;


    // logic[47:0] P;
    // logic PATTERNDETECT;
    // logic PATTERNBDETECT;    
    // xu_priv::dsp_output dsp_data_out;
    // assign P = dsp_data_out.P;
    // assign PATTERNDETECT = dsp_data_out.PATTERNDETECT;
    // assign PATTERNBDETECT = dsp_data_out.PATTERNBDETECT;

     // Hold value for testing clock enables

    xu_priv::alu_lane_ctl alu_mode = 2'b00; // Default to mode 0
    logic [23:0] l0x1;
    logic [17:0] l0acc1;
    logic [17:0] l0x2;
    logic [17:0] l0acc2;
    logic [17:0] l0y1;
    logic [17:0] l0y2;

    logic [23:0] l1x1;
    logic [17:0] l1acc1;
    logic [17:0] l1x2;
    logic [17:0] l1acc2;
    logic [17:0] l1y1;
    logic [17:0] l1y2;

    alu dut(
        .clk           (clk           ),
        .rst           (rst           ),
        .mode          (alu_mode          ),
        .l0x1          (l0x1          ),
        .l0x2          (l0x2          ),
        .l0y1          (l0y1          ),
        .l0y2          (l0y2          ),
        .l0acc1        (l0acc1        ),
        .l0acc2        (l0acc2        ),
        .l0dsp_control (l0dsp_control ),
        .l1x1          (l1x1          ),
        .l1x2          (l1x2          ),
        .l1y1          (l1y1          ),
        .l1y2          (l1y2          ),
        .l1acc1        (l1acc1        ),
        .l1acc2        (l1acc2        ),
        .l1dsp_control (l1dsp_control )
    );


    initial clk = 1'b0;
    always #5 clk = ~clk;

    task automatic tick_and_show(input string tag);
        begin
            @(posedge clk);
            #1;
            $display("[%0t] %s | l0y1=%h l0y2=%h l1y1=%h l1y2=%h",
                $time, tag, l0y1, l0y2, l1y1, l1y2);
        end
    endtask

    initial begin
        $dumpfile("out/tb_alu.vcd");
        $dumpvars(0, tb_alu);

        rst = 1'b1;
        
        l0dsp_control.CEA <= 2'b11;
        l0dsp_control.CEB <= 2'b11;
        l0dsp_control.CEC <= 1'b1;
        l0dsp_control.CED <= 1'b1;
        l0dsp_control.CEM <= 1'b1;
        l0dsp_control.CEP <= 1'b1;
        l0dsp_control.CEAD <= 1'b1;

        l1dsp_control.CEA <= 2'b11;
        l1dsp_control.CEB <= 2'b11;
        l1dsp_control.CEC <= 1'b1;
        l1dsp_control.CED <= 1'b1;
        l1dsp_control.CEM <= 1'b1;
        l1dsp_control.CEP <= 1'b1;
        l1dsp_control.CEAD <= 1'b1;

        // Enable all relevant control clocks for baseline behavior.
        repeat (2) @(posedge clk);
        rst <= 1'b0;

        // Mode 1 18b inputs, simple add: P = A + B + Acc
        l0dsp_control.OPMODE <= 7'b000_1111;
        l0dsp_control.ALUMODE <= 4'b0000;
        l0dsp_control.INMODE <= 5'b00000;

        l1dsp_control.OPMODE <= 7'b000_1111;
        l1dsp_control.ALUMODE <= 4'b0000;
        l1dsp_control.INMODE <= 5'b00000;

        l0x1<= 24'h00_0001;
        l0x2 <= 18'h0_0002;
        l0acc1 <= 18'h00001;
        l0acc2 <= 18'h00001;

        l1x1<= 24'h00_0003;
        l1x2 <= 18'h0_0004;
        l1acc1 <= 18'h00001;
        l1acc2 <= 18'h00001;
        tick_and_show("");
        l0x1<= 24'h00_0003;
        l0x2 <= 18'h0_0005;
        l0acc1 <= 18'h00002;
        l0acc2 <= 18'h00002;

        l1x1<= 24'h00_0007;
        l1x2 <= 18'h0_0009;
        l1acc1 <= 18'h00002;
        l1acc2 <= 18'h00002;        
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");

        rst = 1'b1;
        alu_mode.mode <= 2'b01; // Switch to mode 2 for 18b multiplication + addition
        l0dsp_control.OPMODE <= 7'b011_0101;
        l0dsp_control.ALUMODE <= 4'b0000;
        l0dsp_control.INMODE <= 5'b00000;

        l1dsp_control.OPMODE <= 7'b011_0101;
        l1dsp_control.ALUMODE <= 4'b0000;
        l1dsp_control.INMODE <= 5'b00000;

        l0x1<= 24'h00_0000;
        l0x2 <= 18'h0_0000;
        l0acc1 <= 18'h00000;
        l0acc2 <= 18'h00000;

        l1x1<= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000;
        l1acc2 <= 18'h00000;  
        repeat (2) @(posedge clk);
        rst = 1'b0; 

        l0x1 <= 24'h00_0000;
        l0x2 <= 18'h0_0000;
        l0acc1 <= 18'h00000; //unused
        l0acc2 <= 18'h00000;

        l1x1 <= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h0000f;
        tick_and_show("");
        l0x1 <= 24'h00_0400;
        l0x2 <= 18'h0_0300;
        l0acc1 <= 18'h00000; //unused
        l0acc2 <= 18'h00100;

        l1x1 <= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h00000;
        tick_and_show("");
        l0x1 <= 24'h00_0400;
        l0x2 <= 18'h0_0200;
        l0acc1 <= 18'h00000; //unused
        l0acc2 <= 18'h00100;

        l1x1 <= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h00000;
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        rst = 1'b1;
        alu_mode.mode <= 2'b10; // Switch to mode 3 for 24b addition
        l0dsp_control.OPMODE <= 7'b000_1111;
        l0dsp_control.ALUMODE <= 4'b0000;
        l0dsp_control.INMODE <= 5'b00000;

        l1dsp_control.OPMODE <= 7'b000_1111;
        l1dsp_control.ALUMODE <= 4'b0000;
        l1dsp_control.INMODE <= 5'b00000;

        l0x1<= 24'h00_0000;
        l0x2 <= 18'h0_0000;
        l0acc1 <= 18'h00000;
        l0acc2 <= 18'h00000;

        l1x1<= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000;
        l1acc2 <= 18'h00000;  
        repeat (2) @(posedge clk);
        rst = 1'b0; 

        l0x1 <= 24'h00_000b;
        l0x2 <= 18'h0_aaaa;
        l0acc1 <= 18'h00001; //unused
        l0acc2 <= 18'h01111;

        l1x1 <= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h0000f;
        tick_and_show("");
        l0x1 <= 24'h00_0001;
        l0x2 <= 18'h0_bbbb;
        l0acc1 <= 18'h00001; //unused
        l0acc2 <= 18'h01111;

        l1x1 <= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h00000;
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");

        rst = 1'b1;
        alu_mode.mode <= 2'b11; // Switch to mode 4 for 24b fma
        l0dsp_control.OPMODE <= 7'b001_0101;
        l0dsp_control.ALUMODE <= 4'b0000;
        l0dsp_control.INMODE <= 5'b00000;

        l1dsp_control.OPMODE <= 7'b011_0101;
        l1dsp_control.ALUMODE <= 4'b0000;
        l1dsp_control.INMODE <= 5'b00000;

        l0x1<= 24'h00_0000;
        l0x2 <= 18'h0_0000;
        l0acc1 <= 18'h00000;
        l0acc2 <= 18'h00000;

        l1x1<= 24'h00_0000;
        l1x2 <= 18'h0_0000;
        l1acc1 <= 18'h00000;
        l1acc2 <= 18'h00000;  
        repeat (2) @(posedge clk);
        rst = 1'b0; 

        //l0 = (Ahi*B)+(Alo*B+Acc)

        l0x1 <= 24'h01_0000;
        l0x2 <= 18'h0_0001;
        l0acc1 <= 18'h00000; //unused
        l0acc2 <= 18'h00000; //unused

        l1x1 <= 24'h00_000a;
        l1x2 <= 18'h0_0001;
        l1acc1 <= 18'h00000; //unused
        l1acc2 <= 18'h00001;
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        $finish;
    end
endmodule

`default_nettype wire
