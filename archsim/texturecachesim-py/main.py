import itertools

import cv2
import numpy as np
import cache
import matplotlib.pyplot as plt
from matplotlib.ticker import MultipleLocator
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing as mp
import os
import sys

show_intermediate = False
if (len(sys.argv)==4):
    nSets = int(sys.argv[1])
    nWays = int(sys.argv[2])
    policy = sys.argv[3] if sys.argv[3] in cache.Cache.policies else "FIFO"
    print(f"Number of sets: {nSets}, number of ways: {nWays}, policy: {policy}")
else:
    print("You can run python main.py <nSets> <nWays> <policy>")
    nSets = int(input("Number of sets: "))
    nWays = int(input("Number of ways: "))
    policy = input(f"Policy {cache.Cache.policies}: ")
    show_intermediate = input("Show intermediate images? (y/n): ")
    if show_intermediate == "y":
        show_intermediate = True

    print(f"Number of sets: {nSets}, number of ways: {nWays}, policy: {policy}, show_intermediate: {show_intermediate}")

# Load 16-bit PNG
img_bgr = cv2.imread("test1.png", cv2.IMREAD_UNCHANGED)
img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

list = img.tolist()

textureSizes = {}
with open("texsizes.txt") as f:
    for line in f.readlines():
        values = line.strip().split()

        v1 = int(values[1])
        v2 = int(values[2])
        v3 = int(values[3])

        while v2 > 1024 or v3 > 1024:
            v2 /= 2
            v3 /= 2

        textureSizes[v1] = [v2, v3]

print(f"texture sizes: {textureSizes}")

def get_bit_length(i,len):
    current_len = i.bit_length()
    if current_len > len:
        return i >> (current_len - len)
    else:
        return i

def to_int(i):
    return i / 65535 * (2**10)

for i,cols in enumerate(list):
    for j,pixel in enumerate(cols):
        pixel[1] = to_int(pixel[1])/(2**10)
        pixel[2] = to_int(pixel[2])/(2**10)

img_fin = np.array(list)

# testCache = cache.Cache(64, 'RANDOM')

data = [[0,1,2,3,4,5],
        [6,7,8,9,10,11],
        [12,13,14,15,16,17],]

def pixel_to_tag(pixel, textureSizes):
    result = []
    isFrac = pixel[0] > 32767
    mipmapLevel = (int(pixel[0]) & 0x7F00) >> 8
    textureID = pixel[0] % 256
    textureSize = textureSizes[textureID]

    # texture id format isFrac[0] mipmapLevel[1..7] textureID[8..15]
    if isFrac:  # generate two texture access at different mip levels
        result += [tuple([int(pixel[0] - 32768), int(pixel[1] * textureSize[0] / (2 ** (2 + mipmapLevel))),
                          int(pixel[2] * textureSize[1] / (2 ** (2 + mipmapLevel)))])]
        result += [tuple([int(pixel[0] - 32768 + 256), int(pixel[1] * textureSize[0] / (2 ** (2 + mipmapLevel + 1))),
                          int(pixel[2] * textureSize[1] / (2 ** (2 + mipmapLevel + 1)))])]
        return result
    else:
        return [tuple([int(pixel[0]), int(pixel[1] * textureSize[0] / (2 ** (2 + mipmapLevel))),
                       int(pixel[2] * textureSize[1] / (2 ** (2 + mipmapLevel)))])]

    # return [tuple([int(pixel[0]), int(pixel[1] * textureSize[0] / (2 ** (2))),
    #                    int(pixel[2] * textureSize[1] / (2 ** (2)))])]


def z_render(x, y, width, height, data, waySize, setSize):
    result = []
    if width <= 1 and height <= 1:
        if y < len(data) and x < len(data[0]):
            return pixel_to_tag(data[y][x],textureSizes)
        else:
            return []
    result += z_render(x, y, width // 2, height // 2, data, waySize, setSize)
    result += z_render(x + width // 2, y, width // 2, height // 2, data, waySize, setSize)
    result += z_render(x, y + height // 2, width // 2, height // 2, data, waySize, setSize)
    result += z_render(x + width // 2, y + height // 2, width // 2, height // 2, data, waySize, setSize)
    if (width == 64 and height == 64):
        if x >= len(data[0]) or y >= len(data):
            return []
        else:
            test_cache = cache.Cache(setSize, waySize, policy)
            for i,access in enumerate(result):
                test_cache.access(tuple(access),(access[0]+access[1]+access[2]) % setSize,result,i)

        return [[x, y, test_cache.get_hits(), test_cache.get_misses(), test_cache.get_hit_rate()]]
    return result

def z_render_size(waySize, setSize):
    results = z_render(0, 0, 2048, 2048, list, waySize, setSize)

    sort_list = sorted(results, key=lambda x:x[4])
    total_hits = 0
    total_misses = 0
    for result in sort_list:
        print(f"cache at {result[0]} {result[1]} hits {result[2]} misses {result[3]} hitrate {result[4]}")
        total_hits += result[2]
        total_misses += result[3]

    print(f"total hits: {total_hits} total misses: {total_misses} total hit rate: {total_hits/(total_hits+total_misses)}")
    return [[setSize, waySize, total_hits / (total_hits + total_misses)]]

def plot(plot_data):
    fig, ax = plt.subplots()
    plt.title("Hit Rate vs Cache Size")
    plt.xlabel("Number of cache lines")
    plt.ylabel("Hit Rate")
    plt.ylim(0, 1)
    plt.grid()
    plt.gca().xaxis.set_major_locator(MultipleLocator(1))  # every 1 on x-axis
    plt.gca().yaxis.set_major_locator(MultipleLocator(0.05))  # every 0.1 on y-axis

    setSizeList = [d[0] for d in plot_data]
    waySizeList = [d[1] for d in plot_data]
    overall_hit_rate = [d[2] for d in plot_data]
    scatter = plt.scatter(waySizeList, overall_hit_rate, c=setSizeList)
    fig.colorbar(scatter)
    plt.show()

def main():
    plot_data = []

    with (ProcessPoolExecutor(max_workers=os.cpu_count()) as pool):
        futures = [pool.submit(z_render_size, waySize, setSize) for waySize,setSize in itertools.product(range(1,nWays+1),range(1,nSets+1))]
        for f in as_completed(futures):
            plot_data += f.result()
            plot_data = sorted(plot_data, key=lambda x:(x[0],x[1])) # deterministic plotting
            if show_intermediate:
                plot(plot_data)
            print(sorted(plot_data, key=lambda x:(x[0],x[1])))

    plot(plot_data)

if __name__ == "__main__":
    # On Linux: 'fork' (default) is fine; if you use non-fork-safe libs, use 'spawn'
    try:
        mp.set_start_method("fork")  # or "spawn"
    except RuntimeError:
        # start method was already set (re-runs, embedded environments)
        pass
    main()

