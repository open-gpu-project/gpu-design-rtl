// clang-format off
#include "glad.h" // Leave at very top, before GLFW is included
#include <GLFW/glfw3.h> // Will drag system OpenGL headers
// clang-format on

#include <cstdlib>
#include <iostream>
#include <string>

#include "camera.h"
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "light.h"
#include "model.h"
#include "shader.h"
#include "utils.h"

#define TINYOBJLOADER_IMPLEMENTATION
#include "tiny_obj_loader.h"

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <glm/gtc/type_ptr.hpp>

#include "stb_image_write.h"

void renderModelToImage(Shader mainShader, Model sponza, glm::vec3 loc, glm::vec3 look, float fov,
                        std::string filename);

namespace ImGui {

   template <typename T, typename Getter, typename Setter>
   void SliderFloat(const char* label, T* t, Getter getter, Setter setter, float min, float max,
                    const char* format = "%.3f") {
      float current = (t->*getter)();
      float new_value = current;

      ImGui::SliderFloat(label, &new_value, min, max, format);

      if (current != new_value) {
         (t->*setter)(new_value);
      }
   }

   // template <typename T, typename Getter, typename Setter>
   // void DragFloat3(const char* label, T* obj, Getter getter, Setter setter, float speed, float min,
   //                 float max) {
   //    glm::vec3 current = (obj->*getter)(); // get current value
   //    glm::vec3 newValue = current;

   //    if (ImGui::DragFloat3(label, &newValue[0], speed, min, max)) {
   //       (obj->*setter)(newValue); // update via setter
   //    }
   // }

} // namespace ImGui

Camera camera;

double lastx, lasty;
double cursorx, cursory;

bool mouse_capture = true;

void mouse_callback(GLFWwindow* window, double xpos, double ypos) {
   cursorx = xpos;
   cursory = ypos;
   if (mouse_capture) {
      camera.ProcessMouseMovement(xpos - lastx, lasty - ypos);
   }
   lastx = xpos;
   lasty = ypos;
   ImGui_ImplGlfw_CursorPosCallback(window, xpos, ypos);
}

static void glfw_error_callback(int error, const char* description) {
   std::cerr << "GLFW Error " << error << ": " << description << std::endl;
}

// Main code
int main(int argc, char** argv) {
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
   glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 2);
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

   // Scale ImGui
   ImGui::GetStyle().ScaleAllSizes(highDPIScaleFactor);
   ImGui::GetStyle().FontScaleMain = highDPIScaleFactor;

   // Load resources/fonts/settings/...
   // ...

   const std::string projectRoot = PROJECT_ROOT;
   const std::string objPath = projectRoot + "/archsim/third-party/sponza-model/sponza.obj";
   const std::string dir = projectRoot + "/archsim/third-party/sponza-model/";

   Shader mainShader((projectRoot + "/archsim/stdref-cpp/shaders/main.vert").c_str(),
                     (projectRoot + "/archsim/stdref-cpp/shaders/main.frag").c_str());

   Model sponza(objPath, dir);

   // lighting
   PointLight cubeLight;

   Shader lightCubeShader((projectRoot + "/archsim/stdref-cpp/shaders/lightCube.vert").c_str(),
                          (projectRoot + "/archsim/stdref-cpp/shaders/lightCube.frag").c_str());

   float lightPos[3] = {0.0f, 200.0f, 0.0f};
   float lightColor[3] = {1.0f, 1.0f, 1.0f};
   float lightAttenuationConstants[3] = {1.0f, 0.000009f, 0.0000032f};
   float lightIntensity = 0.5f;

   Shader depthShader((projectRoot + "/archsim/stdref-cpp/shaders/depth.vert").c_str(),
                      (projectRoot + "/archsim/stdref-cpp/shaders/depth.frag").c_str());
   DepthMap dm(depthShader);


   Shader simpleDepthShader(
      (projectRoot + "/archsim/stdref-cpp/shaders/pointShadow.vert").c_str(),
      (projectRoot + "/archsim/stdref-cpp/shaders/pointShadow.frag").c_str(),
      (projectRoot + "/archsim/stdref-cpp/shaders/pointShadow.geom").c_str()
   );
   depthCubeMap dcm(simpleDepthShader);


   // fallback texture (white)
   GLuint fallbackTex;
   glGenTextures(1, &fallbackTex);
   glBindTexture(GL_TEXTURE_2D, fallbackTex);
   const GLubyte texture[4] = {255, 255, 255, 255};
   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, texture);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
   glBindTexture(GL_TEXTURE_2D, 0);

   // variables
   float deltaTime = 0.0f;
   float lastFrame = 0.0f;
   float fov = 45;
   bool wireframe = false;
   bool loadTextures = true;
   glm::vec3 lightDir(0.0f, -1.0f, 0.0f);
   bool blinn = false;
   LightType lightType = Point;
   int imageCounter = 0;

   // setup for render
   glEnable(GL_BLEND);
   glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE);
   glEnable(GL_FRAMEBUFFER_SRGB);
   glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
   glfwSetCursorPosCallback(window, mouse_callback);
   glEnable(GL_DEPTH_TEST);

   // initialize shadows
   dm.drawToTexture(lightDir, sponza);
   dcm.drawToTexture(glm::make_vec3(lightPos), sponza);

   // render to image
   Shader imageShader((projectRoot + "/archsim/stdref-cpp/shaders/image.vert").c_str(),
                                (projectRoot + "/archsim/stdref-cpp/shaders/image.frag").c_str());
   if (argc == 9) {
      renderModelToImage(imageShader,
                         sponza,
                         glm::vec3(std::stof(std::string(argv[1])), std::stof(std::string(argv[2])),
                                   std::stof(std::string(argv[3]))),
                         glm::vec3(std::stof(std::string(argv[4])), std::stof(std::string(argv[5])),
                                   std::stof(std::string(argv[6]))),
                         std::stof(std::string(argv[7])), std::string(argv[8]));
      return 0;
   }

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
      float currentTime = (float)glfwGetTime();
      deltaTime = currentTime - lastFrame;
      lastFrame = currentTime;

      ImGui::Begin("Debug Info");
      ImGui::Text("FPS: %.1f (%.3f ms)", io.Framerate, 1000.0f / io.Framerate);
      ImGui::Text("Position x: %.3f y: %.3f z: %.3f", camera.getPosition().x,
                  camera.getPosition().y, camera.getPosition().z);
      ImGui::Text("Lookat x: %.5f y: %5f z: %5f", camera.getLookAt().x, camera.getLookAt().y,
                  camera.getLookAt().z);
      ImGui::Text("Cursor x: %.3f, y: %.3f", cursorx, cursory);
      if (ImGui::Button("Output Image")) {
         renderModelToImage(imageShader, sponza, camera.getPosition(), camera.getLookAt(), fov, std::format("test{}.png", imageCounter));
         imageCounter++;
      }
      ImGui::End();

      ImGui::Begin("Settings");
      ImGui::SliderFloat("movement speed", &camera, &Camera::getMovementSpeed,
                         &Camera::setMovementSpeed, 0.0f, 1000.0f);
      ImGui::SliderFloat("fov", &fov, 0.0f, 180.0f);
      ImGui::Checkbox("wireframe", &wireframe);
      ImGui::Checkbox("load textures", &loadTextures);

      if (ImGui::RadioButton("None", lightType == None)) lightType = None;
      if (ImGui::RadioButton("Point", lightType == Point)) lightType = Point;
      if (ImGui::RadioButton("Directional", lightType == Directional)) lightType = Directional;

      if (lightType == Point) {
         if (ImGui::DragFloat3("light position", lightPos, 1.0f, -3000.0f, 3000.0f)){
            dcm.drawToTexture(glm::make_vec3(lightPos), sponza);
         }
         ImGui::ColorEdit3("color", lightColor);
         ImGui::SliderFloat("light intensity", &lightIntensity, 0.0f, 5.0f);
         ImGui::DragFloat3("attenuation", lightAttenuationConstants, 0.0000001f, -3.0f, 3.0f,
                           "%.7f");
         ImGui::Checkbox("blinn", &blinn);
      } else if (lightType == Directional) {
         if (ImGui::DragFloat3("light direction", &lightDir[0], 0.0001f, -1.0f, 1.0f)) {
            lightDir = glm::normalize(lightDir); // keep it normalized
            dm.drawToTexture(lightDir, sponza);
         }
         ImGui::ColorEdit3("color", lightColor);
         ImGui::SliderFloat("light intensity", &lightIntensity, 0.0f, 5.0f);
         ImGui::Checkbox("blinn", &blinn);
      }

      ImGui::End();


      if (lightType == Directional)
      {
         ImGui::Begin("Shadow Map");
         ImTextureID id = (ImTextureID)(intptr_t)dm.getDepthMap();

         // flip V (OpenGL’s origin is bottom-left; ImGui’s is top-left)
         ImVec2 uv0 = ImVec2(0, 1);
         ImVec2 uv1 = ImVec2(1, 0);

         // pick a display size (pixels)
         ImGui::Image(id, ImVec2(256, 256), uv0, uv1);
         ImGui::End();
      }

      // Rendering
      ImGui::Render();
      int display_w, display_h;
      glfwGetFramebufferSize(window, &display_w, &display_h);
      glViewport(0, 0, display_w, display_h);
      glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w,
                   clear_color.z * clear_color.w, clear_color.w);
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

      if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) camera.ProcessKeyboard(FORWARD, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS) camera.ProcessKeyboard(BACKWARD, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS) camera.ProcessKeyboard(LEFT, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS) camera.ProcessKeyboard(RIGHT, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_SPACE) == GLFW_PRESS) camera.ProcessKeyboard(UP, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS)
         camera.ProcessKeyboard(DOWN, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS) {
         glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
         mouse_capture = false;
      }
      if (glfwGetKey(window, GLFW_KEY_F) == GLFW_PRESS) {
         glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
         mouse_capture = true;
      }

      glm::mat4 view = glm::mat4(1.0f);
      view = camera.GetViewMatrix();

      glm::mat4 projection;
      projection = glm::perspective(glm::radians(fov), 1280.0f / 720.0f, 0.1f, 3000.0f);

      glm::mat4 model = glm::mat4(1.0f);

      mainShader.use();

      mainShader.setMat4("model", model);
      mainShader.setMat4("view", view);
      mainShader.setMat4("projection", projection);

      mainShader.setInt("lightType", lightType);
      mainShader.setVec3("light.position", glm::make_vec3(lightPos));
      mainShader.setVec3("light.direction", glm::make_vec3(lightDir));

      mainShader.setFloat("light.constant", lightAttenuationConstants[0]);
      mainShader.setFloat("light.linear", lightAttenuationConstants[1]);
      mainShader.setFloat("light.quadratic", lightAttenuationConstants[2]);
      mainShader.setBool("blinn", blinn);
      mainShader.setVec3("lightColor", glm::make_vec3(lightColor));
      mainShader.setVec3("viewPos", glm::make_vec3(camera.getPosition()));
      mainShader.setFloat("lightIntensity", lightIntensity);
      mainShader.setMat4("lightSpaceMatrix", dm.getLightSpaceMatrix());

      if (wireframe) {
         glPolygonMode(GL_FRONT_AND_BACK, GL_LINE);
      } else {
         glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
      }

      glActiveTexture(GL_TEXTURE0);
      glBindTexture(GL_TEXTURE_2D, fallbackTex);

      glActiveTexture(GL_TEXTURE5);
      glBindTexture(GL_TEXTURE_2D, dm.getDepthMap());
      mainShader.setInt("depthMap", 5);

      glActiveTexture(GL_TEXTURE6);
      glBindTexture(GL_TEXTURE_CUBE_MAP, dcm.getDepthCubeMap());
      mainShader.setInt("cubeDepthMap", 6);

      mainShader.setFloat("far_plane", 2500.0f);

      sponza.render(mainShader, loadTextures);


      // light
      glm::mat4 lightModel = glm::mat4(1.0f);

      switch (lightType) {
         case Point:
            lightCubeShader.use();
            lightModel = glm::translate(lightModel, glm::make_vec3(lightPos));
            lightModel = glm::scale(lightModel, glm::vec3(100.0f));
            lightCubeShader.setMat4("model", lightModel);
            lightCubeShader.setMat4("view", view);
            lightCubeShader.setMat4("projection", projection);
            lightCubeShader.setVec3("lightColor", glm::make_vec3(lightColor));
            cubeLight.draw();
            break;
         case None:
            break;
         case Directional:
            break;
         default:
            break;
      }

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

void renderModelToImage(Shader shader, Model m, glm::vec3 loc, glm::vec3 look, float fov,
                        std::string filename) {
   const int W = 1280, H = 720;

   // --- Setup FBO once (not every frame!)
   GLuint fbo, colorTex, depthRb;
   glGenFramebuffers(1, &fbo);
   glBindFramebuffer(GL_FRAMEBUFFER, fbo);

   // Color texture
   glGenTextures(1, &colorTex);
   glBindTexture(GL_TEXTURE_2D, colorTex);
   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, W, H, 0, GL_RGB, GL_UNSIGNED_BYTE, nullptr);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
   glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colorTex, 0);

   // Depth renderbuffer
   glGenRenderbuffers(1, &depthRb);
   glBindRenderbuffer(GL_RENDERBUFFER, depthRb);
   glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, W, H);
   glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, depthRb);

   if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
      throw std::runtime_error("Framebuffer incomplete");
   }

   // --- Render
   glViewport(0, 0, W, H);
   glBindFramebuffer(GL_FRAMEBUFFER, fbo);
   glClearColor(0, 0, 0, 1);
   glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

   shader.use();
   shader.setInt("lightType", LightType::None);
   glm::vec3 dir = look-loc;
   glm::mat4 view;

   // handling looking straight down
   if (dir.x == 0 && dir.z == 0){
      view = glm::lookAt(loc, look, {0, 0, 1});
   } else {
      view = glm::lookAt(loc, look, {0, 1, 0});
   }

   glm::mat4 proj = glm::perspective(glm::radians(fov), (float)W / H, 0.1f, 10000.0f);
   glm::mat4 model(1.0f);
   shader.setMat4("model", model);
   shader.setMat4("view", view);
   shader.setMat4("projection", proj);

   m.render(shader, true);

   // --- Read back
   std::vector<GLubyte> pixels(W * H * 3);
   glPixelStorei(GL_PACK_ALIGNMENT, 1);
   glReadPixels(0, 0, W, H, GL_RGB, GL_UNSIGNED_BYTE, pixels.data());

   stbi_flip_vertically_on_write(true);
   if (!stbi_write_png(filename.c_str(), W, H, 3, pixels.data(), 3840)){
      std::cout << "image write failed" << "\n";
   } else {
      std::cout << "image write success" << "\n";
   }

   // --- Cleanup (or keep for reuse)
   glDeleteRenderbuffers(1, &depthRb);
   glDeleteTextures(1, &colorTex);
   glDeleteFramebuffers(1, &fbo);
}