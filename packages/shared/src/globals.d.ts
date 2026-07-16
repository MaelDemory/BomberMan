// @bomber/shared n'inclut ni lib DOM ni types Node (simulation agnostique) ;
// structuredClone existe pourtant dans les deux runtimes (navigateurs et Node ≥ 17).
declare function structuredClone<T>(value: T): T;
