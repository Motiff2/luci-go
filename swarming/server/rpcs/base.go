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

// Package rpcs implements public API RPC handlers.
package rpcs

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"go.chromium.org/luci/common/data/stringset"
	"go.chromium.org/luci/common/errors"
	"go.chromium.org/luci/common/logging"
	"go.chromium.org/luci/gae/service/datastore"
	"go.chromium.org/luci/grpc/grpcutil"

	apipb "go.chromium.org/luci/swarming/proto/api_v2"
	"go.chromium.org/luci/swarming/server/acls"
	"go.chromium.org/luci/swarming/server/cfg"
	"go.chromium.org/luci/swarming/server/model"
)

var requestStateCtxKey = "swarming.rpcs.RequestState"

const (
	// Default size of a single page of results for listing queries.
	defaultPageSize = 100
	// Maximum allowed size of a single page of results for listing queries.
	maxPageSize = 1000
)

// SwarmingServer implements Swarming gRPC service.
//
// It is a collection of various RPCs that didn't fit other services. Individual
// RPCs are implemented in swarming_*.go files.
type SwarmingServer struct {
	apipb.UnimplementedSwarmingServer
}

// BotsServer implements Bots gRPC service.
//
// It exposes methods to view and manipulate state of Swarming bots. Individual
// RPCs are implemented in bots_*.go files.
type BotsServer struct {
	apipb.UnimplementedBotsServer

	// BotQuerySplitMode controls how "finely" to split BotInfo queries.
	BotQuerySplitMode model.SplitMode
}

// TasksServer implements Tasks gRPC service.
//
// It exposes methods to view and manipulate state of Swarming tasks. Individual
// RPCs are implemented in tasks_*.go files.
type TasksServer struct {
	apipb.UnimplementedTasksServer
}

// RequestState carries stated scoped to a single RPC handler.
//
// In production produced by ServerInterceptor. In tests can be injected into
// the context via MockRequestState(...).
//
// Use State(ctx) to get the current value.
type RequestState struct {
	// Config is a snapshot of the server configuration when request started.
	Config *cfg.Config
	// ACL can be used to check ACLs.
	ACL *acls.Checker
}

// ServerInterceptor returns an interceptor that initializes per-RPC context.
//
// The interceptor is active only for selected gRPC services. All other RPCs
// are passed through unaffected.
//
// The initialized context will have RequestState populated, use State(ctx) to
// get it.
func ServerInterceptor(cfg *cfg.Provider, services []*grpc.ServiceDesc) grpcutil.UnifiedServerInterceptor {
	serviceSet := stringset.New(len(services))
	for _, svc := range services {
		serviceSet.Add(svc.ServiceName)
	}

	return func(ctx context.Context, fullMethod string, handler func(ctx context.Context) error) error {
		// fullMethod looks like "/<service>/<method>". Get "<service>".
		if fullMethod == "" || fullMethod[0] != '/' {
			panic(fmt.Sprintf("unexpected fullMethod %q", fullMethod))
		}
		service := fullMethod[1:strings.LastIndex(fullMethod, "/")]
		if service == "" {
			panic(fmt.Sprintf("unexpected fullMethod %q", fullMethod))
		}

		if !serviceSet.Has(service) {
			return handler(ctx)
		}

		cfg := cfg.Config(ctx)
		return handler(context.WithValue(ctx, &requestStateCtxKey, &RequestState{
			Config: cfg,
			ACL:    acls.NewChecker(ctx, cfg),
		}))
	}
}

// State accesses the per-request state in the context or panics if it is
// not there.
func State(ctx context.Context) *RequestState {
	state, _ := ctx.Value(&requestStateCtxKey).(*RequestState)
	if state == nil {
		panic("no RequestState in the context")
	}
	return state
}

// ValidateLimit validates a page size limit in listing queries.
func ValidateLimit(val int32) (int32, error) {
	if val == 0 {
		val = defaultPageSize
	}
	switch {
	case val < 0:
		return val, errors.Reason("must be positive, got %d", val).Err()
	case val > maxPageSize:
		return val, errors.Reason("must be less or equal to %d, got %d", maxPageSize, val).Err()
	}
	return val, nil
}

// FetchTaskRequest fetches a task request given its ID.
//
// Returns gRPC status errors, logs internal errors. Does not check ACLs yet.
// It is the caller's responsibility.
func FetchTaskRequest(ctx context.Context, taskID string) (*model.TaskRequest, error) {
	if taskID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "task_id is required")
	}
	key, err := model.TaskIDToRequestKey(ctx, taskID)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "task_id %s: %s", taskID, err)
	}
	req := &model.TaskRequest{Key: key}
	switch err = datastore.Get(ctx, req); {
	case errors.Is(err, datastore.ErrNoSuchEntity):
		return nil, status.Errorf(codes.NotFound, "no such task")
	case err != nil:
		logging.Errorf(ctx, "Error fetching TaskRequest %s: %s", taskID, err)
		return nil, status.Errorf(codes.Internal, "datastore error fetching the task")
	default:
		return req, nil
	}
}
