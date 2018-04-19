'use strict';

const assert = require('assert');

const graph = require('../lib/graph.js');

describe('graph', () => {
  describe('find', () => {
    it('empty graph', () => {
      const g = graph.create('id', 'test');
      assert.strictEqual(g.find('n1'), null);
    });
    it('missing', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      assert.strictEqual(g.find('n2'), null);
    });
    it('existing', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      assert.strictEqual(g.find('n1').id(), 'n1');
      assert.strictEqual(g.find('n1').data(), 1);
      assert.deepStrictEqual(g.find('n1').outgoing(), []);
      assert.deepStrictEqual(g.find('n1').incoming(), []);
    });
    it('multiple existing', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      assert.strictEqual(g.find('n1').data(), 1);
      assert.strictEqual(g.find('n2').data(), 2);
      assert.strictEqual(g.find('n3').data(), 3);
    });
  });
  describe('connect', () => {
    it('happy', () => {
      const g = graph.create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2).connect(n1);
      assert.strictEqual(n1.outgoing().length, 0);
      assert.strictEqual(n1.incoming().length, 1);
      assert.strictEqual(n1.incoming()[0].id(), 'n2');
      assert.strictEqual(n2.outgoing().length, 1);
      assert.strictEqual(n2.outgoing()[0].id(), 'n1');
      assert.strictEqual(n2.incoming().length, 0);
    });
  });
  describe('findAndConnect', () => {
    it('happy', () => {
      const g = graph.create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2', 2).findAndConnect('n1');
      assert.strictEqual(n1.outgoing().length, 0);
      assert.strictEqual(n1.incoming().length, 1);
      assert.strictEqual(n1.incoming()[0].id(), 'n2');
      assert.strictEqual(n2.outgoing().length, 1);
      assert.strictEqual(n2.outgoing()[0].id(), 'n1');
      assert.strictEqual(n2.incoming().length, 0);
    });
  });
  describe('filter', () => {
    it('empty graph', () => {
      const g = graph.create('id', 'test');
      const nodes = g.filter(() => true);
      assert.strictEqual(nodes.length, 0);
    });
    it('all true', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter(() => true);
      assert.strictEqual(nodes.length, 3);
    });
    it('all false', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter(() => false);
      assert.strictEqual(nodes.length, 0);
    });
    it('condition on data', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => (node.data() % 2) === 0);
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0].id(), 'n2');
    });
    it('condition on id', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => node.id() === 'n3');
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0].id(), 'n3');
    });
    it('condition on outgoing', () => {
      const g = graph.create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2).connect(n1);
      g.create('n3', 'test3', 3);
      const nodes = g.filter((node) => node.outgoing().length > 0);
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0].id(), 'n2');
    });
  });
  describe('toDOT', () => {
    it('empty', () => {
      const g = graph.create('id', 'test');
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '}', ''];
      assert.strictEqual(g.toDOT(), lines.join('\n'));
    });
    it('single node', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '}', ''];
      assert.strictEqual(g.toDOT(), lines.join('\n'));
    });
    it('two nodes', () => {
      const g = graph.create('id', 'test');
      g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '}', ''];
      assert.strictEqual(g.toDOT(), lines.join('\n'));
    });
    it('two nodes connected', () => {
      const g = graph.create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      g.create('n2', 'test2', 2).connect(n1);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '"n2" -> "n1";', '}', ''];
      assert.strictEqual(g.toDOT(), lines.join('\n'));
    });
    it('two nodes all connected', () => {
      const g = graph.create('id', 'test');
      const n1 = g.create('n1', 'test1', 1);
      const n2 = g.create('n2', 'test2',  2).connect(n1);
      n1.connect(n2);
      const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', '"n2"[label="test2"];', '"n1" -> "n2";', '"n2" -> "n1";', '}', ''];
      assert.strictEqual(g.toDOT(), lines.join('\n'));
    });
    describe('subgraphs', () => {
      it('mixed subgraph and root', () => {
        const g = graph.create('id', 'test');
        g.create('n1', 'test1', 1);
        g.subgraph('sub1', 'test1');
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', '"n1"[label="test1"];', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '}', '}', ''];
        assert.strictEqual(g.toDOT(), lines.join('\n'));
      });
      it('single subgraph', () => {
        const g = graph.create('id', 'test');
        const sub1 = g.subgraph('sub1', 'test1');
        sub1.create('n1', 'test1', 1);
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '"n1"[label="test1"];', '}', '}', ''];
        assert.strictEqual(g.toDOT(), lines.join('\n'));
      });
      it('two subgraphs', () => {
        const g = graph.create('id', 'test');
        g.subgraph('sub1', 'test1');
        g.subgraph('sub2', 'test2');
        const lines = ['digraph "id" {', 'rankdir=LR;', 'label="test";', 'subgraph "cluster_sub1" {', 'rankdir=LR;', 'label="test1";', '}', 'subgraph "cluster_sub2" {', 'rankdir=LR;', 'label="test2";', '}', '}', ''];
        assert.strictEqual(g.toDOT(), lines.join('\n'));
      });
    });
  });
});
