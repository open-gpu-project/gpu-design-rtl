#version 330 core
out vec4 FragColor;
  
in vec3 Normal;
in vec2 TexCoords;
in vec3 FragPos;

struct Material {
   sampler2D diffuse;
   sampler2D specular;
   sampler2D alpha;
   float shininess;
};

struct Light {
   vec3 position;  
   vec3 direction;
  
   vec3 ambient;
   vec3 diffuse;
   vec3 specular;
	
   float constant;
   float linear;
   float quadratic;
};

uniform vec3 lightPos;
uniform vec3 lightColor;
uniform vec3 viewPos;
uniform Material material;
uniform Light light; 
uniform float lightIntensity;
uniform bool hasOpacityMask;
uniform bool blinn;
uniform int lightType;

void main() {
    if (lightType == 0){
        // alpha
        float alpha = 1.0;
        if (hasOpacityMask) {
            alpha = texture(material.alpha, TexCoords).a;
        }
        if (alpha < 0.5)
        discard;

        // no lighting, just texture
        FragColor = texture(material.diffuse, TexCoords);
    } else if (lightType == 1 || lightType == 2){
        vec3 norm = normalize(Normal);
        vec3 lightDir;

        if (lightType == 1){
            lightDir = normalize(lightPos - FragPos);
        } else {
            lightDir = normalize(-light.direction);
        }

        // diffuse
        float diff = max(dot(norm,lightDir), 0.0f);

        // specular
        vec3 viewDir = normalize(viewPos-FragPos);
        vec3 reflectDir = reflect(-lightDir, norm);
        float spec = 0.0f;
        if (blinn){
            vec3 halfwayVec = normalize(viewDir + lightDir);
            spec = pow(max(dot(halfwayVec, norm),0.0),material.shininess);
        } else {
            spec = pow(max(dot(viewDir, reflectDir),0.0),material.shininess);
        }

        // alpha
        float alpha = 1.0;
        if (hasOpacityMask) {
            alpha = texture(material.alpha, TexCoords).a;
        }
        if (alpha < 0.5)
        discard;

        // results of each component
        vec3 ambient  = lightIntensity * lightColor  * vec3(texture(material.diffuse, TexCoords));
        vec3 diffuse  = lightIntensity * lightColor  * diff * vec3(texture(material.diffuse, TexCoords));  
        vec3 specular = lightIntensity * lightColor * spec * vec3(texture(material.specular, TexCoords));

        // attenuation
        float distance = length(light.position - FragPos);
        float attenuation = 1.0 / (light.constant + light.linear * distance + light.quadratic * (distance * distance));    

        if (lightType == 1){
            ambient *= attenuation;
            diffuse *= attenuation;
            specular *= attenuation;
        }

        // results
        FragColor = vec4(ambient + diffuse + specular, alpha); 
    }
}