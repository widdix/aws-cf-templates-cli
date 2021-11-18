import { strict as assert } from 'assert';
import { create } from '../lib/graph.js';

describe('graph', () => {
  describe('sort', () => {
    it('empty graph', () => {
      const g = create('id', 'test');
      assert.deepEqual(g.sort(), []);
    });
    it('one node, no connections', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      assert.deepEqual(g.sort().map(n => n.id()), ['n1']);
    });
    it('two nodes, no connections', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      assert.deepEqual(g.sort().map(n => n.id()), ['n1', 'n2']);
    });
    it('two nodes, single connection', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2);
      n1.connect(n2);
      assert.deepEqual(g.sort().map(n => n.id()), ['n2', 'n1']);
    });
    it('two nodes, cyclic connection, no start nodes', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2);
      n1.connect(n2);
      n2.connect(n1);
      assert.throws(() => g.sort().map(n => n.id()), /^Error: no start nodes found$/);
    });
    it('three nodes, cyclic connection', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      n1.connect(n2);
      n2.connect(n1);
      assert.throws(() => g.sort().map(n => n.id()), /^Error: cyclic connections found$/);
    });
    it('three nodes, single connection', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2);
      const n3 = g.create('n3', 'test2', 3);
      n1.connect(n2);
      n2.connect(n3);
      assert.deepEqual(g.sort().map(n => n.id()), ['n3', 'n2', 'n1']);
    });
    it('three nodes, multiple connections', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2);
      const n3 = g.create('n3', 'test2', 3);
      n1.connect(n2);
      n1.connect(n3);
      n2.connect(n3);
      assert.deepEqual(g.sort().map(n => n.id()), ['n3', 'n2', 'n1']);
    });
  });
  describe('find', () => {
    it('empty graph', () => {
      const g = create('id', 'test');
      assert.equal(g.find('n1'), null);
    });
    it('missing', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      assert.equal(g.find('n2'), null);
    });
    it('existing', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      assert.equal(g.find('n1').id(), 'n1');
      assert.equal(g.find('n1').data(), 1);
      assert.deepEqual(g.find('n1').outgoing(), []);
      assert.deepEqual(g.find('n1').incoming(), []);
    });
    it('multiple existing', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      assert.equal(g.find('n1').data(), 1);
      assert.equal(g.find('n2').data(), 2);
      assert.equal(g.find('n3').data(), 3);
    });
  });
  describe('connect', () => {
    it('happy', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2).connect(n1);
      assert.equal(n1.outgoing().length, 0);
      assert.equal(n1.incoming().length, 1);
      assert.equal(n1.incoming()[0].id(), 'n2');
      assert.equal(n2.outgoing().length, 1);
      assert.equal(n2.outgoing()[0].id(), 'n1');
      assert.equal(n2.incoming().length, 0);
    });
  });
  describe('findAndConnect', () => {
    it('happy', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2).findAndConnect('n1');
      assert.equal(n1.outgoing().length, 0);
      assert.equal(n1.incoming().length, 1);
      assert.equal(n1.incoming()[0].id(), 'n2');
      assert.equal(n2.outgoing().length, 1);
      assert.equal(n2.outgoing()[0].id(), 'n1');
      assert.equal(n2.incoming().length, 0);
    });
  });
  describe('filter', () => {
    it('empty graph', () => {
      const g = create('id', 'test');
      const nodes = g.filter(() => true);
      assert.equal(nodes.length, 0);
    });
    it('all true', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter(() => true);
      assert.equal(nodes.length, 3);
    });
    it('all false', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter(() => false);
      assert.equal(nodes.length, 0);
    });
    it('condition on data', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => (node.data() % 2) === 0);
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].id(), 'n2');
    });
    it('condition on id', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => node.id() === 'n3');
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].id(), 'n3');
    });
    it('condition on outgoing', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2).connect(n1);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => node.outgoing().length > 0);
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].id(), 'n2');
    });
  });
  describe('toDOT', () => {
    it('empty', () => {
      const g = create('id', 'test');
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '}', ''];
      assert.equal(g.toDOT(), lines.join('\n'));
    });
    it('single node', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '}', ''];
      assert.equal(g.toDOT(), lines.join('\n'));
    });
    it('two nodes', () => {
      const g = create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '}', ''];
      assert.equal(g.toDOT(), lines.join('\n'));
    });
    it('two nodes connected', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2).connect(n1);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '"n2" -> "n1";', '}', ''];
      assert.equal(g.toDOT(), lines.join('\n'));
    });
    it('two nodes all connected', () => {
      const g = create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2',  2).connect(n1);
      n1.connect(n2);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '"n1" -> "n2";', '"n2" -> "n1";', '}', ''];
      assert.equal(g.toDOT(), lines.join('\n'));
    });
    describe('subgraphs', () => {
      it('mixed subgraph and root', () => {
        const g = create('id', 'test');
        g.create('n1', 'test1', 1);
        g.subgraph('sub1', 'test1');
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '}', '}', ''];
        assert.equal(g.toDOT(), lines.join('\n'));
      });
      it('single subgraph', () => {
        const g = create('id', 'test');
        const sub1 = g.subgraph('sub1', 'test1');
        sub1.create('n1', 'test1', 1);
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '"n1"[label="test1"];', '}', '}', ''];
        assert.equal(g.toDOT(), lines.join('\n'));
      });
      it('two subgraphs', () => {
        const g = create('id', 'test');
        g.subgraph('sub1', 'test1');
        g.subgraph('sub2', 'test2');
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '}', 'subgraph "cluster_sub2" {', 'rankdir=LR;', 'label="test2";', '}', '}', ''];
        assert.equal(g.toDOT(), lines.join('\n'));
      });
    });
  });
});
