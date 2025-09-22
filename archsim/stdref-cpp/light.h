#pragma once
#include "glad.h"
#include "model.h"
#include "shader.h"
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <vector>
#include <string>

enum LightType { None = 0, Point = 1, Directional = 2 };

float cubeVertices[] = {-0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  0.5f,  -0.5f,
                        0.5f,  0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f, -0.5f,

                        -0.5f, -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,  0.5f,
                        0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, -0.5f, 0.5f,

                        -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f, -0.5f,
                        -0.5f, -0.5f, -0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,

                        0.5f,  0.5f,  0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f,
                        0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,  0.5f,

                        -0.5f, -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, 0.5f,
                        0.5f,  -0.5f, 0.5f,  -0.5f, -0.5f, 0.5f,  -0.5f, -0.5f, -0.5f,

                        -0.5f, 0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  0.5f,
                        0.5f,  0.5f,  0.5f,  -0.5f, 0.5f,  0.5f,  -0.5f, 0.5f,  -0.5f};

class PointLight {
public:
   float color[3];
   float position[3];
   float lightAttenuationConstants[3];
   unsigned int VAO, VBO;

   PointLight(const float* color = nullptr, const float* position = nullptr,
              const float* attenuation = nullptr) {
      // Set default values if arguments are not provided
      const float defaultColor[3] = {1.0f, 1.0f, 1.0f};
      const float defaultPosition[3] = {0.0f, 100.0f, 0.0f};
      const float defaultAttenuation[3] = {1.0f, 0.000009f, 0.0000032f};

      for (int i = 0; i < 3; ++i) {
         this->color[i] = color ? color[i] : defaultColor[i];
         this->position[i] = position ? position[i] : defaultPosition[i];
         this->lightAttenuationConstants[i] = attenuation ? attenuation[i] : defaultAttenuation[i];
      }

      glGenVertexArrays(1, &VAO);
      glBindVertexArray(VAO);

      glGenBuffers(1, &VBO);
      glBindBuffer(GL_ARRAY_BUFFER, VBO);
      glBufferData(GL_ARRAY_BUFFER, sizeof(cubeVertices), cubeVertices, GL_STATIC_DRAW);

      glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3 * sizeof(float), (void*)0);
      glEnableVertexAttribArray(0);
   }

   void draw() {
      glBindVertexArray(VAO);
      glDrawArrays(GL_TRIANGLES, 0, 36);
   }
};

// class DirectionalLight{
//    float color[3];
//    float direction[3];
//    DirectionalLight(const float* color){
//       const float defaultColor[3] = {1.0f, 1.0f, 1.0f};
//       for (int i = 0; i < 3; ++i) {
//          this->color[i] = color ? color[i] : defaultColor[i];
//       }
//    }
// };

class DepthMap {
public:
   DepthMap(Shader& depthShader) : depthShader(depthShader) {
      glGenFramebuffers(1, &depthMapFBO);
      GLenum err = glGetError();
      if (err != GL_NO_ERROR) {
         fprintf(stderr, "Error generating framebuffer: 0x%x\n", err);
      }
      // create depth texture
      glGenTextures(1, &depthMap);
      err = glGetError();
      if (err != GL_NO_ERROR) {
         fprintf(stderr, "Error generating texture: 0x%x\n", err);
      }
      glBindTexture(GL_TEXTURE_2D, depthMap);
      glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT, SHADOW_WIDTH, SHADOW_HEIGHT, 0,
                   GL_DEPTH_COMPONENT, GL_FLOAT, NULL);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_BORDER);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_BORDER);
      float borderColor[] = {1.0, 1.0, 1.0, 1.0};
      glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_BORDER_COLOR, borderColor);
      // attach depth texture as FBO's depth buffer
      glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
      glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depthMap, 0);
      glDrawBuffer(GL_NONE);
      glReadBuffer(GL_NONE);
      glBindFramebuffer(GL_FRAMEBUFFER, 0);
      err = glGetError();
      if (err != GL_NO_ERROR) {
         fprintf(stderr, "Error during framebuffer setup: 0x%x\n", err);
      }
   }

   void drawToTexture(glm::vec3 lightDir, Model m) {
      glm::mat4 lightProjection, lightView;
      glm::mat4 lightModel2 = glm::mat4(1.0f);

      float near_plane = 1.0f, far_plane = 7000.0f;
      lightProjection = glm::ortho(-1300.0f, 1300.0f, -1500.0f, 1500.0f, near_plane, far_plane);
      lightProjection = glm::scale(lightProjection, glm::vec3(0.6));
      if (lightDir.x == 0 && lightDir.z == 0){
         lightView = glm::lookAt(lightDir * (-3000.0f), glm::vec3(0.0f), glm::vec3(0.0, 0.0, 1.0));
      } else {
         lightView = glm::lookAt(lightDir * (-3000.0f), glm::vec3(0.0f), glm::vec3(0.0, 1.0, 0.0));
      }
      lightSpaceMatrix = lightProjection * lightView;
      // render scene from light's point of view
      depthShader.use();
      depthShader.setMat4("lightSpaceMatrix", lightSpaceMatrix);
      depthShader.setMat4("model", lightModel2);

      glViewport(0, 0, SHADOW_WIDTH, SHADOW_HEIGHT);
      glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
      glClear(GL_DEPTH_BUFFER_BIT);
      // glBindVertexArray(VAO);
      // for (auto m :mesh) {
      //    glDrawElements(GL_TRIANGLES, m.size, GL_UNSIGNED_INT, (void*)(m.startIndex *
      //    sizeof(int)));
      // }
      m.renderGeometry();
      glBindFramebuffer(GL_FRAMEBUFFER, 0);
   }
   int getDepthMap() { return depthMap; }

   glm::mat4 getLightSpaceMatrix() { return lightSpaceMatrix; }

private:
   unsigned int depthMapFBO;
   unsigned int depthMap;
   const unsigned int SHADOW_WIDTH = 4096, SHADOW_HEIGHT = 4096;
   Shader depthShader;
   glm::mat4 lightSpaceMatrix;
};

class depthCubeMap {
public:
    static constexpr unsigned SHADOW_WIDTH  = 2048;
    static constexpr unsigned SHADOW_HEIGHT = 2048;

    GLuint depthMapFBO = 0;
    GLuint depthCubemap = 0;
    Shader simpleDepthShader;
   float near_plane = 1.0f;
   float far_plane  = 2500.0f;

    depthCubeMap(Shader& s) : simpleDepthShader(s) {
      glGenFramebuffers(1, &depthMapFBO);
      // create depth cubemap texture
      glGenTextures(1, &depthCubemap);
      glBindTexture(GL_TEXTURE_CUBE_MAP, depthCubemap);
      for (unsigned int i = 0; i < 6; ++i)
         glTexImage2D(GL_TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, GL_DEPTH_COMPONENT, SHADOW_WIDTH, SHADOW_HEIGHT, 0, GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
      glTexParameteri(GL_TEXTURE_CUBE_MAP, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_CUBE_MAP, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_CUBE_MAP, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_CUBE_MAP, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_CUBE_MAP, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
      // attach depth texture as FBO's depth buffer
      glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
      glFramebufferTexture(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, depthCubemap, 0);
      glDrawBuffer(GL_NONE);
      glReadBuffer(GL_NONE);
      glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }

    void drawToTexture(const glm::vec3& lightPos, Model& m) {
        // 0. create depth cubemap transformation matrices
        // -----------------------------------------------
        glm::mat4 shadowProj = glm::perspective(glm::radians(90.0f), (float)SHADOW_WIDTH / (float)SHADOW_HEIGHT, near_plane, far_plane);
        std::vector<glm::mat4> shadowTransforms;
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3( 1.0f,  0.0f,  0.0f), glm::vec3(0.0f, -1.0f,  0.0f)));
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3(-1.0f,  0.0f,  0.0f), glm::vec3(0.0f, -1.0f,  0.0f)));
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3( 0.0f,  1.0f,  0.0f), glm::vec3(0.0f,  0.0f,  1.0f)));
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3( 0.0f, -1.0f,  0.0f), glm::vec3(0.0f,  0.0f, -1.0f)));
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3( 0.0f,  0.0f,  1.0f), glm::vec3(0.0f, -1.0f,  0.0f)));
        shadowTransforms.push_back(shadowProj * glm::lookAt(lightPos, lightPos + glm::vec3( 0.0f,  0.0f, -1.0f), glm::vec3(0.0f, -1.0f,  0.0f)));

        // 1. render scene to depth cubemap
        // --------------------------------
        glViewport(0, 0, SHADOW_WIDTH, SHADOW_HEIGHT);
        glBindFramebuffer(GL_FRAMEBUFFER, depthMapFBO);
            glClear(GL_DEPTH_BUFFER_BIT);
            simpleDepthShader.use();
            simpleDepthShader.setMat4("model", glm::mat4(1.0f));

            for (unsigned int i = 0; i < 6; ++i)
                simpleDepthShader.setMat4("shadowMatrices[" + std::to_string(i) + "]", shadowTransforms[i]);
            simpleDepthShader.setFloat("far_plane", far_plane);
            simpleDepthShader.setVec3("lightPos", lightPos);
            m.renderGeometry();
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }

    GLuint getDepthCubeMap() const { return depthCubemap; }
};
