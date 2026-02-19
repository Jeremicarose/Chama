access(all) contract TestSimple {
    access(all) var count: UInt64
    access(all) fun getCount(): UInt64 { return self.count }
    init() { self.count = 0 }
}
