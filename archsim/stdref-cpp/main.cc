// clang-format off
#include "glad.h" // Leave at very top, before GLFW is included
#include <GLFW/glfw3.h> // Will drag system OpenGL headers
// clang-format on

#include <cstdlib>
#include <iostream>

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

static void glfw_error_callback(int error, const char* description) {
   std::cerr << "GLFW Error " << error << ": " << description << std::endl;
}

// Main code
int main(int, char**) {
   // FIXME(kevin): Possibly Pop-OS specific wayland only...!
   setenv("XCURSOR_SIZE", "24", 0);

   glfwSetErrorCallback(glfw_error_callback);
   if (!glfwInit()) return 1;

   // Decide GL+GLSL versions
#if defined(IMGUI_IMPL_OPENGL_ES2)
   // GL ES 2.0 + GLSL 100 (WebGL 1.0)
   const char* glsl_version = "#version 100";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
#elif defined(IMGUI_IMPL_OPENGL_ES3)
   // GL ES 3.0 + GLSL 300 es (WebGL 2.0)
   const char* glsl_version = "#version 300 es";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
#elif defined(__APPLE__)
   // GL 3.2 + GLSL 150
   const char* glsl_version = "#version 150";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 2);
   glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE); // 3.2+ only
   glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);           // Required on Mac
#else
   // GL 3.0 + GLSL 130
   const char* glsl_version = "#version 130";
   glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
   // glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);  // 3.2+ only
   // glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);            // 3.0+ only
#endif

   // Set up High-DPI scaling
   float highDPIScaleFactor = 1.0f;
   {
      GLFWmonitor* monitor = glfwGetPrimaryMonitor();
      float scaleX, scaleY;
      glfwGetMonitorContentScale(monitor, &scaleX, &scaleY);
      if (scaleX > 1 || scaleY > 1) {
         highDPIScaleFactor = std::max(scaleX, scaleY);
         // FIXME(kevin): HiDPI for Windows, I think
         glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);
         // FIXME(kevin): HiDPI for Linux Wayland systems, I think
         glfwWindowHint(GLFW_SCALE_FRAMEBUFFER, GLFW_TRUE);
      }
      std::cout << "Monitor scaling factor: " << scaleX << std::endl;
   }

   // Create window with graphics context
   GLFWwindow* window = glfwCreateWindow(1280, 720, "...", nullptr, nullptr);
   if (window == nullptr) {
      std::cerr << "Failed to create GLFW window" << std::endl;
      return -1;
   }
   glfwMakeContextCurrent(window);
   glfwSwapInterval(1); // Enable vsync

   // Load the OpenGL APIs
   if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
      std::cerr << "Failed to initialize GLAD" << std::endl;
      return -1;
   }

   // Set up ImGui context
   auto ctx = ImGui::CreateContext();
   ImGui::SetCurrentContext(ctx);

   // Setup Platform/Renderer backends
   ImGui_ImplGlfw_InitForOpenGL(window, true);
   ImGui_ImplOpenGL3_Init(glsl_version);

   // Load resources/fonts/settings/...
   // ...

   // Main loop
   auto& io = ImGui::GetIO();
   ImVec4 clear_color = ImVec4(0.45f, 0.55f, 0.60f, 1.00f);
   while (!glfwWindowShouldClose(window)) {
      // Poll and handle events (inputs, window resize, etc.)
      glfwPollEvents();

      // If the window has not been set up, wait a little
      if (glfwGetWindowAttrib(window, GLFW_ICONIFIED) != 0) {
         ImGui_ImplGlfw_Sleep(10);
         continue;
      }

      // Start the Dear ImGui frame
      ImGui_ImplOpenGL3_NewFrame();
      ImGui_ImplGlfw_NewFrame();
      ImGui::NewFrame();

      // Perform per-frame action
      // ...

      // Rendering
      ImGui::Render();
      int display_w, display_h;
      glfwGetFramebufferSize(window, &display_w, &display_h);
      glViewport(0, 0, display_w, display_h);
      glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w,
                   clear_color.z * clear_color.w, clear_color.w);
      glClear(GL_COLOR_BUFFER_BIT);
      ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
      glfwSwapBuffers(window);
   }

   // Cleanup
   ImGui_ImplOpenGL3_Shutdown();
   ImGui_ImplGlfw_Shutdown();
   glfwDestroyWindow(window);
   glfwTerminate();

   return 0;
}
