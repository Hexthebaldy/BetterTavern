#!/usr/bin/env bash
# 每天的定时部署要不要上这个提交（.github/workflows/deploy.yml）。只看 git 历史，要有完整的历史：
#
#   scripts/deploy-gate.sh <线上的提交> <要部署的提交> [<服务器上 deploy-hold 里的提交>]
#
# 输出一个词：
#   none       线上已经是这个提交，或者比它新
#   held       线上回滚过或上线失败过，这个提交没有比当时的版本新，等新的提交
#   migration  带数据库迁移（改表结构）：定时任务不自动上，等人手动部署
#   go         可以上

set -euo pipefail

deployed=${1:?缺线上的提交}
target=${2:?缺要部署的提交}
hold=${3:-}

# 第二个提交包含第一个吗；不认识的提交不当作“不包含”，直接报错，免得误判成可以上
contains() {
  local status=0
  git merge-base --is-ancestor "$1" "$2" || status=$?
  [[ $status -le 1 ]] || exit 2
  return "$status"
}

if contains "$target" "$deployed"; then
  echo none
elif [[ -n $hold ]] && contains "$target" "$hold"; then
  echo held
elif [[ -n $(git diff --name-only "$deployed" "$target" -- apps/server/migrations/versions) ]]; then
  echo migration
else
  echo go
fi
