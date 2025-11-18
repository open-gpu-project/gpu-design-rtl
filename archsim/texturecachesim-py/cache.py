import random

from fontTools.t1Lib import hintothers

import fullyassociativecache


class Cache:
    policies = ["OPT","FIFO","LRU","RANDOM"]

    def __init__(self, sets=4, ways=4, policy='OPT'):
        self.cache = {}
        self.hits = 0
        self.misses = 0
        self.sets = [fullyassociativecache.FullyAssociativeCache(ways,policy) for _ in range(sets)]
        self.policy = policy

    def get_hits(self):
        return self.hits

    def get_misses(self):
        return self.misses

    def get_hit_rate(self):
        return float(self.hits) / (self.hits + self.misses)

    def access(self, tag, index, trace=[], trace_index=None):
        if index >= len(self.sets):
            raise IndexError

        # print(tag,index)
        # for c in self.sets:
        #     print(c.get_data())

        result = self.sets[index].access(tag, trace, trace_index)

        if result == 'hit':
            self.hits += 1
            return 'hit'
        elif result == 'miss':
            self.misses += 1
            return 'miss'


        # if self.policy == 'LRU':
        #     print(tag, self.lru_list)
        #     print(f'added {tag} to cache')
        # print(self.cache.keys())

# test_cache = Cache(2,2, 'OPT')
# trace = [1,2,3,4]
# for index,i in enumerate(trace):
#     print(test_cache.access(trace[index],trace[index]%2, trace, index))
#
# print(test_cache.get_hit_rate())
