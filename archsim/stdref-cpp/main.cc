// clang-format off
#include "glad.h" // Leave at very top, before GLFW is included
#include <GLFW/glfw3.h> // Will drag system OpenGL headers
// clang-format on

#include <cstdlib>
#include <iostream>

#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"

#define TINYOBJLOADER_IMPLEMENTATION
#include "tiny_obj_loader.h"

#include "camera.cc"
#include "shader.cc"
#include <glm/gtc/type_ptr.hpp>

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

Camera camera;

double lastx, lasty;
double cursorx, cursory;

bool mouse_focus = true;


void mouse_callback(GLFWwindow* window, double xpos, double ypos){
   cursorx = xpos;
   cursory = ypos;
   if (mouse_focus){
      camera.ProcessMouseMovement(xpos-lastx, lasty-ypos);
   }
   lastx = xpos;
   lasty = ypos;
   ImGui_ImplGlfw_CursorPosCallback(window, xpos, ypos);
}

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

   std::string objPath = "../archsim/third-party/sponza-model/sponza.obj";
   std::string dir = "../archsim/third-party/sponza-model/";

   Shader mainShader("../archsim/stdref-cpp/main.vert","../archsim/stdref-cpp/main.frag");

   tinyobj::attrib_t attrib;                  // holds vertex arrays
   std::vector<tinyobj::shape_t> shapes;      // holds faces grouped into objects
   std::vector<tinyobj::material_t> materials;// holds material info
   std::string warn, err;

   bool ret = tinyobj::LoadObj(
      &attrib, &shapes, &materials, &warn, &err,
      objPath.c_str(),        // path to OBJ
      dir.c_str(),           // path to MTL + textures
      true                 // triangulate polygons
   );

   if (!warn.empty()) std::cout << "WARN: " << warn << "\n";
   if (!err.empty()) std::cerr << "ERR: " << err << "\n";
   if (!ret) return 1;

   std::cout << "Loaded " << shapes.size() << " shapes\n";
   std::cout << "Loaded " << materials.size() << " materials\n";

   std::map<int,std::vector<tinyobj::index_t>> materialGroup;

   std::map<std::string,GLuint> loaded_texture;

   for (const tinyobj::material_t mat: materials){
      if(!mat.diffuse_texname.empty()){
         if (!loaded_texture.contains(mat.diffuse_texname)){
            stbi_set_flip_vertically_on_load(true);  
            GLuint textureID;
            glGenTextures(1,&textureID);
            glBindTexture(GL_TEXTURE_2D, textureID);
            int width, height, channels;
            unsigned char* data = stbi_load((dir+mat.diffuse_texname).c_str(), &width, &height, &channels, 0);
            GLenum format = GL_RGB;
            if (channels == 1) format = GL_RED;
            else if (channels == 3) format = GL_RGB;
            else if (channels == 4) format = GL_RGBA;

            glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

            glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0,
                        format, GL_UNSIGNED_BYTE, data);
            glGenerateMipmap(GL_TEXTURE_2D);

            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

            stbi_image_free(data);

            loaded_texture[mat.diffuse_texname] = textureID;
         }
      }
   }

   // std::vector<float> vertices;

   for (int i = 0; i< shapes.size(); i++){
      tinyobj::shape_t currentShape = shapes.at(i);
      tinyobj::mesh_t currentMesh = currentShape.mesh;
      for (int j = 0; j + 2 < currentMesh.indices.size(); j += 3){
         int currentMaterialID = currentMesh.material_ids.at(j / 3);
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j));
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j+1));
         materialGroup[currentMaterialID].push_back(currentMesh.indices.at(j+2));
      }
   }

   struct Vertex {
      float position[3];
      float normal[3];
      float uv[2];

      // Strict lexicographic compare (avoids memcmp/padding issues)
      bool operator<(const Vertex &v) const {
         for (int i = 0; i < 3; ++i) if (position[i] != v.position[i]) return position[i] < v.position[i];
         for (int i = 0; i < 3; ++i) if (normal[i]   != v.normal[i])   return normal[i]   < v.normal[i];
         for (int i = 0; i < 2; ++i) if (uv[i]       != v.uv[i])       return uv[i]       < v.uv[i];
         return false;
      }
   };
   static_assert(sizeof(Vertex) == 8 * sizeof(float), "Vertex has unexpected padding");

   struct Mesh {
      int materialID;
      int startIndex;
      int size;
   };

   std::vector<Vertex> vertices;
   std::map<Vertex, int> vertexMap;
   std::vector<int> indices;
   std::vector<Mesh> mesh;

   int startIndex = 0;

   for (int i = 0; i < materials.size(); i++){
      std::vector<tinyobj::index_t> m_indices = materialGroup[i];

      Mesh currentMesh;
      currentMesh.materialID = i;
      currentMesh.startIndex = startIndex;

      for (int j = 0; j < m_indices.size(); j++){

         tinyobj::index_t currentIndex = m_indices[j];
         float position[3], normal[3], uv[2];
         position[0] = attrib.vertices[3*currentIndex.vertex_index];
         position[1] = attrib.vertices[3*currentIndex.vertex_index + 1];
         position[2] = attrib.vertices[3*currentIndex.vertex_index + 2];
         normal[0] = attrib.normals[3*currentIndex.normal_index];
         normal[1] = attrib.normals[3*currentIndex.normal_index + 1];
         normal[2] = attrib.normals[3*currentIndex.normal_index + 2];      
         uv[0] = attrib.texcoords[2*currentIndex.texcoord_index];
         uv[1] = attrib.texcoords[2*currentIndex.texcoord_index + 1];                  
         Vertex v = { {position[0], position[1], position[2]}, {normal[0], normal[1], normal[2]}, {uv[0], uv[1]} };
         if (vertexMap.count(v)==0){
            vertexMap[v] = vertices.size();
            vertices.push_back(v);
         }
         indices.push_back(vertexMap[v]);
      }
      startIndex += m_indices.size();
      currentMesh.size = m_indices.size();
      mesh.push_back(currentMesh);
   }

   std::cout << "Loaded " << vertices.size() << " vertices"<< "\n";
   std::cout << "Loaded " << indices.size()/3 << " triangles"<< "\n";

   unsigned int VBO, VAO, EBO;
   glGenVertexArrays(1, &VAO);
   glGenBuffers(1, &VBO);
   glGenBuffers(1, &EBO);

   glBindVertexArray(VAO);

   glBindBuffer(GL_ARRAY_BUFFER, VBO);
   glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);

   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
   glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(int), indices.data(), GL_STATIC_DRAW);

   // vertex position
   glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void*)0);
   glEnableVertexAttribArray(0);

   // normal
   glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void*) (3*sizeof(float)));
   glEnableVertexAttribArray(1);

   // texture coordinates
   glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void*) (6*sizeof(float)));
   glEnableVertexAttribArray(2);

   glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);  

   glfwSetCursorPosCallback(window, mouse_callback);  

   glEnable(GL_DEPTH_TEST);  

   float deltaTime = 0.0f;
   float lastFrame = 0.0f;

   float fov = 45;
   camera.MovementSpeed = 300.0f;
   camera.MouseSensitivity = 0.3f;
   bool wireframe = false;

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
      float currentTime = (float) glfwGetTime();
      deltaTime = currentTime - lastFrame;
      lastFrame = currentTime;

      ImGui::Begin("Info");
      ImGui::SliderFloat("speed", &camera.MovementSpeed, 0.0f, 500.0f);
      ImGui::SliderFloat("fov", &fov, 0.0f, 180.0f);
      ImGui::Checkbox("wireframe", &wireframe);

      ImGui::Text("fps: %.3f ", 1/deltaTime);

      ImGui::Text("Position x: %.3f y: %.3f z: %.3f", camera.Position.x, camera.Position.y, camera.Position.z);
      ImGui::Text("Lookat x: %.3f y: %3f z: %3f", camera.Front.x, camera.Front.y, camera.Front.z);
      ImGui::Text("cursor x: %.3f", cursorx);
      ImGui::Text("cursor y: %.3f", cursory);

      ImGui::End();

      // Rendering
      ImGui::Render();
      int display_w, display_h;
      glfwGetFramebufferSize(window, &display_w, &display_h);
      glViewport(0, 0, display_w, display_h);
      glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w,
                   clear_color.z * clear_color.w, clear_color.w);
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

      if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) camera.ProcessKeyboard(FORWARD,  deltaTime);
      if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS) camera.ProcessKeyboard(BACKWARD, deltaTime);
      if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS) camera.ProcessKeyboard(LEFT,     deltaTime);
      if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS) camera.ProcessKeyboard(RIGHT,    deltaTime);
      if (glfwGetKey(window, GLFW_KEY_SPACE) == GLFW_PRESS) camera.ProcessKeyboard(UP,    deltaTime);
      if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS) camera.ProcessKeyboard(DOWN,    deltaTime);
      if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS){
            glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
            mouse_focus = false;
      }
      if (glfwGetKey(window, GLFW_KEY_F) == GLFW_PRESS){
            glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
            mouse_focus = true;
      }


      glm::mat4 view = glm::mat4(1.0f);
      view = camera.GetViewMatrix();

      glm::mat4 projection;
      projection = glm::perspective(glm::radians(fov), 1280.0f / 720.0f, 0.1f, 3000.0f);

      glm::mat4 model = glm::mat4(1.0f);

      glUniformMatrix4fv(glGetUniformLocation(mainShader.ID, "model"),1,GL_FALSE, glm::value_ptr(model));
      glUniformMatrix4fv(glGetUniformLocation(mainShader.ID, "view"),1,GL_FALSE, glm::value_ptr(view));
      glUniformMatrix4fv(glGetUniformLocation(mainShader.ID, "projection"),1,GL_FALSE, glm::value_ptr(projection));

      if (wireframe){
         glPolygonMode(GL_FRONT_AND_BACK, GL_LINE);
      } else {
         glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
      }
      mainShader.use();
      glBindVertexArray(VAO);
      glBindBuffer(GL_ARRAY_BUFFER, VBO);
      glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);

      for (int i = 0; i < mesh.size(); i++){
         Mesh m = mesh.at(i);
         tinyobj::material_t mat = materials.at(i);
         
         glBindTexture(GL_TEXTURE_2D, loaded_texture[mat.diffuse_texname]);
         glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void *)(m.startIndex * sizeof(int)));
      }

      // glDrawArrays(GL_TRIANGLES, 0, vertices.size());

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
