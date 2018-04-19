'use strict';

const create = (gid, glabel) => {
  const subgraphs = new Map();
  const nodes = new Map();
  const find = (id) => {
    const internalNode = nodes.get(id);
    if (internalNode === undefined) {
      return null;
    }
    return nodeWrapper(internalNode);
  };
  const nodeWrapper = (internalNode) => {
    const connect = (node) => {
      const internalNode2 = nodes.get(node.id());
      if (internalNode2 === undefined) {
        throw new Error(`node ${node.id()} does not exist`);
      }
      internalNode.outgoing.add(internalNode2.id);
      internalNode2.incoming.add(internalNode.id);
      return nodeWrapper(internalNode);
    };
    return {
      id: () => internalNode.id,
      label: () => internalNode.label,
      data: () => internalNode.data,
      findAndConnect: (id)=> {
        const node = find(id);
        if (node === null) {
          throw new Error(`node ${id} does not exist`);
        } else {
          return connect(node);
        }
      },
      connect,
      outgoing: () => {
        const res = [];
        for (const id of internalNode.outgoing.values()) {
          res.push(find(id));
        }
        return res;
      },
      incoming: () => {
        const res = [];
        for (const id of internalNode.incoming.values()) {
          res.push(find(id));
        }
        return res;
      }
    };
  };
  const _toDOT = (type) => {
    let dot = '';
    if (type === 'subgraph') {
      dot += `${type} "cluster_${gid}" {\n`;
    } else {
      dot += `${type} "${gid}" {\n`;
    }
    dot += 'rankdir=LR;\n';
    dot += `label="${glabel}";\n`;
    for (const internalNode of nodes.values()) {
      const node = nodeWrapper(internalNode);
      dot += `"${node.id()}"[label="${node.label()}"];\n`;      
    }
    for (const internalNode of nodes.values()) {
      const node = nodeWrapper(internalNode);
      dot += node.outgoing().map(n => `"${node.id()}" -> "${n.id()}";\n`).join('');
    }
    for (const g of subgraphs.values()) {
      dot += g._toDOT('subgraph');
    }
    dot += '}\n';
    return dot;
  };
  return {
    id: () => {
      return gid;
    },
    label: () => {
      return glabel;
    },
    create: (id, label, data) => {
      const internalNode = {id, label, data, outgoing: new Set(), incoming: new Set()};
      nodes.set(id, internalNode);
      return nodeWrapper(internalNode);
    },
    find,
    filter: (condition) => {
      const res = [];
      for (const internalNode of nodes.values()) {
        const node = nodeWrapper(internalNode);
        if (condition(node) === true) {
          res.push(node);
        }
      }
      return res;
    },
    subgraph: (id, label) => {
      if (subgraphs.has(id)) {
        return subgraphs.get(id);
      } else {
        const g = create(id, label);
        subgraphs.set(id, g);
        return g;
      }
    },
    _toDOT: _toDOT,
    toDOT: () => {
      return _toDOT('digraph');
    }
  };
};
module.exports.create = create;
