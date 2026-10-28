import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
const target=process.argv[2]||path.join(os.homedir(),'.dsh/profiles/desktop/node_modules/@furongjun1999/dsh-memory');
const file=path.join(target,'md_cg/mdcg.py');const source=fs.readFileSync(file,'utf8');
if(source.includes('bucket_scope_nodes = sum(')){console.log('灵枢分桶健康范围修复已存在');process.exit(0);}
const old='        h = routing.bucket_health(self.index.get("buckets", {}),\n                                  total_nodes=len(self.index["nodes"]))';
const fixed='        # Only layers with physical buckets belong in bucket health.\n        bucket_scope_nodes = sum(\n            entry.get("layer", "knowledge") in BUCKETED_LAYERS\n            for entry in self.index["nodes"].values())\n        h = routing.bucket_health(self.index.get("buckets", {}),\n                                  total_nodes=bucket_scope_nodes)\n        h["bucket_scope_nodes"] = bucket_scope_nodes';
const normalized=source.replaceAll('\r\n','\n');if(!normalized.includes(old))throw Error('灵枢源码版本不兼容，未修改');
if(!fs.existsSync(file+'.before-bucket-scope.bak'))fs.copyFileSync(file,file+'.before-bucket-scope.bak');fs.writeFileSync(file,normalized.replace(old,fixed));console.log('已修复灵枢分桶健康范围；重启DSH生效');
