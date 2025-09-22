## Usage
### Interactive mode
Explore Sponza scene with different settings. Movable with WASD as well as space to go up and left shift to go down. To interact with ui, use escape to stop mouse capture and f to reenable.
``` bash
./stdref-cpp
```
### Command arguments mode
Saves a photo of the scene with customizable camera and fov using texture only rendering
``` bash
./stdref-cpp camx camy camz lookatx lookaty lookatz fov fileName
# example
./stdref-cpp 0 500 0 1000 500 0 45 test.png
```
