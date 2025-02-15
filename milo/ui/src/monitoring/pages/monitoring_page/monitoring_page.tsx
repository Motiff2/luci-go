// Copyright 2024 The LUCI Authors.
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

import NotesIcon from '@mui/icons-material/Notes';
import {
  Alert,
  Avatar,
  CircularProgress,
  LinearProgress,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { useQuery, useQueries } from '@tanstack/react-query';
import { uniq, chunk, flatten } from 'lodash-es';
import { forwardRef } from 'react';
import {
  Link as RouterLink,
  LinkProps as RouterLinkProps,
  useParams,
} from 'react-router-dom';

import { RecoverableErrorBoundary } from '@/common/components/error_handling';
import { PageMeta } from '@/common/components/page_meta';
import { UiPage } from '@/common/constants/view';
import { useIssueListQuery } from '@/common/hooks/gapi_query/corp_issuetracker';
import { usePrpcServiceClient } from '@/common/hooks/prpc_query';
import { Alerts } from '@/monitoring/components/alerts';
import { configuredTrees } from '@/monitoring/util/config';
import { AlertJson, bugFromJson } from '@/monitoring/util/server_json';
import {
  BatchGetAlertsRequest,
  AlertsClientImpl as NotifyAlertsClientImpl,
} from '@/proto/go.chromium.org/luci/luci_notify/api/service/v1/alerts.pb';
import {
  AlertsClientImpl,
  ListAlertsRequest,
} from '@/proto/infra/appengine/sheriff-o-matic/proto/v1/alerts.pb';

export const MonitoringPage = () => {
  const { tree: treeName } = useParams();
  const tree = configuredTrees.find((t) => t.name === treeName);

  const client = usePrpcServiceClient({
    host: SETTINGS.sheriffOMatic.host,
    ClientImpl: AlertsClientImpl,
  });
  const alertsQuery = useQuery({
    ...client.ListAlerts.query(
      ListAlertsRequest.fromPartial({
        parent: `trees/${treeName}`,
      }),
    ),
    refetchInterval: 60000,
    enabled: !!(treeName && tree),
  });
  const notifyClient = usePrpcServiceClient({
    host: SETTINGS.luciNotify.host,
    ClientImpl: NotifyAlertsClientImpl,
  });
  // Eventually all of the deata will come from LUCI Notify, but for now we just extend the
  // SOM alerts with the LUCI Notify alerts.
  const batches = chunk(alertsQuery.data?.alerts || [], 100);
  const extendedQuery = useQueries({
    queries: batches.map((batch) => ({
      ...notifyClient.BatchGetAlerts.query(
        BatchGetAlertsRequest.fromPartial({
          names: batch.map((a) => `alerts/${encodeURIComponent(a.key)}`),
        }),
      ),
      refetchInterval: 60000,
      enabled: !!(treeName && tree && alertsQuery.data),
    })),
  });

  const extendedQueryData = flatten(
    extendedQuery.map((result) => result?.data?.alerts),
  );
  const linkedBugs = uniq(
    (extendedQueryData || []).map((a) => a?.bug).filter((b) => b && b !== '0'),
  );

  const hotlistPart = tree?.hotlistId
    ? `(status:open AND hotlistid:${tree?.hotlistId})`
    : '';
  const linkedIssuesPart = linkedBugs.map((b) => 'id:' + b).join(' OR ');
  const bugQuery = useIssueListQuery(
    {
      query: `${hotlistPart}${hotlistPart !== '' && linkedIssuesPart !== '' ? ' OR ' : ''}${linkedIssuesPart}`,
      orderBy: 'priority',
    },
    {
      refetchInterval: 60000,
      enabled: !extendedQuery.some((q) => q.isLoading),
    },
  );

  if (!treeName || !tree) {
    return (
      <>
        <PageMeta title="Monitoring" selectedPage={UiPage.Monitoring} />
        <Typography variant="h4">Monitoring: Trees</Typography>
        <List
          component="nav"
          sx={{ width: '100%', maxWidth: 360, bgcolor: 'background.paper' }}
        >
          {configuredTrees.map((t) => (
            <ListItemButton
              key={t.display_name}
              component={Link}
              to={`/ui/labs/monitoring/${t.name}`}
            >
              <ListItemAvatar>
                <Avatar>
                  <NotesIcon />
                </Avatar>
              </ListItemAvatar>
              <ListItemText primary={t.display_name} secondary={t.name} />
            </ListItemButton>
          ))}
        </List>
      </>
    );
  }
  const bugs = bugQuery.data?.issues?.map((i) => bugFromJson(i)) || [];

  if (alertsQuery.isError) {
    throw alertsQuery.error;
  }
  if (extendedQuery.some((q) => q.isError)) {
    throw extendedQuery.find((q) => q.isError && q.error);
  }
  if (alertsQuery.isLoading || extendedQuery.some((q) => q.isLoading)) {
    return <CircularProgress />;
  }

  // Extend the alerts with the LUCI Notify data.
  const alerts = alertsQuery.data.alerts.map((a, i) => {
    const extended = extendedQuery[Math.floor(i / 100)].data?.alerts[i % 100];
    const bug = extended?.bug;
    return {
      ...(JSON.parse(a.alertJson) as AlertJson),
      bug: !bug || bug === '0' ? '' : bug,
      silenceUntil: extended?.silenceUntil,
    };
  });
  return (
    <>
      <PageMeta
        title="Monitoring"
        selectedPage={UiPage.Monitoring}
        project={tree?.project}
      />
      {bugQuery.isLoading ? <LinearProgress /> : null}
      {bugQuery.isError ? (
        <Alert severity="error">
          Failed to fetch bugs: {(bugQuery.error as Error).message}
        </Alert>
      ) : null}
      <Alerts alerts={alerts} tree={tree} bugs={bugs} />
    </>
  );
};

const Link = forwardRef<HTMLAnchorElement, RouterLinkProps>(
  function Link(itemProps, ref) {
    return <RouterLink ref={ref} {...itemProps} role={undefined} />;
  },
);

export function Component() {
  return (
    // See the documentation for `<LoginPage />` for why we handle error this
    // way.
    <RecoverableErrorBoundary key="monitoring-page">
      <MonitoringPage />
    </RecoverableErrorBoundary>
  );
}
