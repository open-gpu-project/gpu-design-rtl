import random


class FullyAssociativeCache:

    def __init__(self, size=64, policy='FIFO'):
        self.cache = {}
        self.hits = 0
        self.misses = 0
        self.max_size = size
        self.queue = []
        self.policy = policy
        self.lru_list = []

    def get_hits(self):
        return self.hits

    def get_misses(self):
        return self.misses

    def get_hit_rate(self):
        return float(self.hits) / (self.hits + self.misses)

    def get_data(self):
        return self.cache

    def access(self, tag, trace=[], index=None):
        if tag in self.cache:
            self.hits += 1
            # print("hits: %d" % self.hits)
            # return self.cache[key]
            if self.policy == 'LRU':
                lru_index = self.lru_list.index(tag)
                self.lru_list.pop(lru_index)
                self.lru_list.insert(0,tag)
            return 'hit'
        else:
            self.misses += 1
            # print("misses: %d" % self.misses)
            if len(self.cache) >= self.max_size:
                if self.policy == 'FIFO':
                    removeKey = self.queue.pop(0)
                    self.cache.pop(removeKey)
                    # print(f'removed {removeKey} in cache')
                elif self.policy == 'OPT':
                    if trace==[] and index is None:
                        print(f'{self.policy}: no trace nor index')
                        return
                    else:
                        trace = trace[index:]
                        next_index = {}
                        for k in self.cache:
                            if k in trace:
                                next_index[k] = trace.index(k)
                            else:
                                next_index[k] = len(trace)
                                break
                        max_key = max(next_index,key=next_index.get)
                        self.cache.pop(max_key)
                        # print(f'removed {max_key} in cache')
                elif self.policy == 'RANDOM':
                    removeKey = random.choice(list(self.cache.items()))[0]
                    self.cache.pop(removeKey)
                    # print(f'removed {removeKey} in cache')
                elif self.policy == 'LRU':
                    removeKey = self.lru_list.pop(-1)
                    self.cache.pop(removeKey)


            self.cache[tag] = None

            if self.policy == 'FIFO':
                self.queue.append(tag)

            if self.policy == 'LRU':
                self.lru_list.insert(0,tag)

            return 'miss'

        # if self.policy == 'LRU':
        #     print(tag, self.lru_list)
        #     print(f'added {tag} to cache')
        # print(self.cache.keys())

# test_cache = Cache(3, 'LRU')
# trace = [1,2,3,4,3,2,1]
# for index,i in enumerate(trace):
#     test_cache.access(trace[index], trace, index)
