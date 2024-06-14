// Copyright 2023 The LUCI Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { CacheOption } from '@/generic_libs/tools/cached_fn';
import { PrpcClientExt } from '@/generic_libs/tools/prpc_client_ext';
import { Constructor } from '@/generic_libs/types';

export type PrpcMethod<Req, Ret> = (
  req: Req,
  opt?: CacheOption,
) => Promise<Ret>;

export type PrpcMethodRequest<T> =
  T extends PrpcMethod<infer Req, infer _Res> ? Req : never;

export type PrpcMethodResponse<T> =
  T extends PrpcMethod<infer _Req, infer Res> ? Res : never;

export type PrpcServiceMethodKeys<S> = keyof {
  // The request type has to be `any` because the argument type must be contra-
  // variant when sub-typing a function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [MK in keyof S as S[MK] extends PrpcMethod<any, object> ? MK : never]: S[MK];
};

export interface PrpcQueryBaseOptions<S, MK, Req> {
  readonly host: string;
  readonly insecure?: boolean;
  readonly Service: Constructor<S, [PrpcClientExt]> & { SERVICE: string };
  readonly method: MK;
  readonly request: Req;
}

/**
 * Generate a key to match a pRPC query call.
 *
 * Note that this function is not a hook and can be used in non-React
 * environment.
 */
export function genPrpcQueryKey<S, MK, Req>(
  identity: string,
  opts: PrpcQueryBaseOptions<S, MK, Req>,
) {
  const { host, Service, method, request } = opts;

  return [
    // The query response is tied to the user identity (ACL). The user
    // identity may change after a auth state refresh after user logs in/out
    // in another browser tab.
    identity,
    // Some pRPC services may get hosted on multiple hosts (e.g. swarming).
    // Ensure the query to one host is not reused by query to another host.
    host,
    // Ensure methods sharing the same name from different services won't
    // cause collision.
    Service.SERVICE,
    // Obviously query to one method shall not be reused by query to another
    // method.
    method,
    // Include the whole request so whenever the request is changed, a new
    // RPC call is triggered.
    request,
  ] as const;
}
