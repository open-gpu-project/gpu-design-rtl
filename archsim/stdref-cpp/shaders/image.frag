#version 330 core
out vec4 FragColor;

struct Material {
   sampler2D diffuse;
};
  
in vec2 TexCoords;

uniform Material material;

void main() {
   float alpha = 1.0;
      alpha = texture(material.diffuse, TexCoords).a;
   if (alpha < 0.5)
      discard;
   FragColor = texture(material.diffuse, TexCoords);
}