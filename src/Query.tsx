import * as React from 'react';
import * as PropTypes from 'prop-types';
import ApolloClient, {
  ObservableQuery,
  ApolloQueryResult,
  ApolloError,
  FetchPolicy,
  ErrorPolicy,
  ApolloCurrentResult,
  NetworkStatus,
} from 'apollo-client';
import { DocumentNode } from 'graphql';
import { ZenObservable } from 'zen-observable-ts';
import { OperationVariables } from './types';
import { parser, DocumentType } from './parser';

const shallowEqual = require('fbjs/lib/shallowEqual');
const invariant = require('invariant');

// Improved FetchMoreOptions type, need to port them back to Apollo Client
export interface FetchMoreOptions<TData, TVariables> {
  updateQuery: (
    previousQueryResult: TData,
    options: {
      fetchMoreResult?: TData;
      variables: TVariables;
    },
  ) => TData;
}

// Improved FetchMoreQueryOptions type, need to port them back to Apollo Client
export interface FetchMoreQueryOptions<TVariables, K extends keyof TVariables> {
  variables: Pick<TVariables, K>;
}

// XXX open types improvement PR to AC
// Improved ObservableQuery field types, need to port them back to Apollo Client
export type ObservableQueryFields<TData, TVariables> = Pick<
  ObservableQuery<TData>,
  'startPolling' | 'stopPolling'
> & {
  refetch: (variables?: TVariables) => Promise<ApolloQueryResult<TData>>;
  fetchMore: (<K extends keyof TVariables>(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, K> &
      FetchMoreOptions<TData, TVariables>,
  ) => Promise<ApolloQueryResult<TData>>) &
    (<TData2, TVariables2, K extends keyof TVariables2>(
      fetchMoreOptions: { query: DocumentNode } & FetchMoreQueryOptions<
        TVariables2,
        K
      > &
        FetchMoreOptions<TData2, TVariables2>,
    ) => Promise<ApolloQueryResult<TData2>>);
  updateQuery: (
    mapFn: (
      previousQueryResult: TData,
      options: { variables?: TVariables },
    ) => TData,
  ) => void;
};

function observableQueryFields<TData, TVariables>(
  observable: ObservableQuery<TData>,
): ObservableQueryFields<TData, TVariables> {
  const fields = {
    refetch: observable.refetch.bind(observable),
    fetchMore: observable.fetchMore.bind(observable),
    updateQuery: observable.updateQuery.bind(observable),
    startPolling: observable.startPolling.bind(observable),
    stopPolling: observable.stopPolling.bind(observable),
  };
  // TODO: Need to cast this because we improved the type of `updateQuery` to be parametric
  // on variables, while the type in Apollo client just has object.
  // Consider removing this when that is properly typed
  return fields as ObservableQueryFields<TData, TVariables>;
}

function isDataFilled<TData>(data: {} | TData): data is TData {
  return Object.keys(data).length > 0;
}

export interface QueryResult<TData = any, TVariables = OperationVariables>
  extends ObservableQueryFields<TData, TVariables> {
  client: ApolloClient<any>;
  data?: TData;
  error?: ApolloError;
  loading: boolean;
  networkStatus: NetworkStatus;
}

export interface QueryProps<TData = any, TVariables = OperationVariables> {
  children: (result: QueryResult<TData, TVariables>) => React.ReactNode;
  fetchPolicy?: FetchPolicy;
  errorPolicy?: ErrorPolicy;
  notifyOnNetworkStatusChange?: boolean;
  pollInterval?: number;
  query: DocumentNode;
  variables?: TVariables;
  ssr?: boolean;
  skip?: boolean;
}

export interface QueryState<TData = any> {
  result: ApolloCurrentResult<TData>;
}

export interface QueryContext {
  client: ApolloClient<Object>;
}

class Query<
  TData = any,
  TVariables = OperationVariables
> extends React.Component<QueryProps<TData, TVariables>, QueryState<TData>> {
  static contextTypes = {
    client: PropTypes.object.isRequired,
  };

  static propTypes = {
    children: PropTypes.func.isRequired,
    fetchPolicy: PropTypes.string,
    notifyOnNetworkStatusChange: PropTypes.bool,
    pollInterval: PropTypes.number,
    query: PropTypes.object.isRequired,
    variables: PropTypes.object,
    ssr: PropTypes.bool,
  };

  context: QueryContext;

  private client: ApolloClient<Object>;
  private queryObservable: ObservableQuery<TData>;
  private querySubscription: ZenObservable.Subscription;
  private previousData: any = {};

  constructor(props: QueryProps<TData, TVariables>, context: QueryContext) {
    super(props, context);

    invariant(
      !!context.client,
      `Could not find "client" in the context of Query. Wrap the root component in an <ApolloProvider>`,
    );
    this.client = context.client;

    this.initializeQueryObservable(props);
    this.state = {
      result: this.queryObservable.currentResult(),
    };
  }

  // For server-side rendering (see getDataFromTree.ts)
  fetchData(): Promise<ApolloQueryResult<any>> | boolean {
    const { children, ssr, skip, ...opts } = this.props;

    let { fetchPolicy } = opts;
    if (ssr === false || skip) return false;
    if (fetchPolicy === 'network-only' || fetchPolicy === 'cache-and-network') {
      fetchPolicy = 'cache-first'; // ignore force fetch in SSR;
    }

    const observable = this.client.watchQuery({
      ...opts,
      fetchPolicy,
    });
    const result = this.queryObservable.currentResult();

    if (result.loading) {
      return observable.result();
    } else {
      return false;
    }
  }

  componentDidMount() {
    if (!this.props.skip) {
      this.startQuerySubscription();
    }
  }

  componentWillReceiveProps(
    nextProps: QueryProps<TData, TVariables>,
    nextContext: QueryContext,
  ) {
    if (nextProps.skip) {
      // if this has changed, we better unsubscribe
      this.removeQuerySubscription();
      return;
    }

    if (
      shallowEqual(this.props, nextProps) &&
      this.client === nextContext.client
    ) {
      return;
    }

    if (this.client !== nextContext.client) {
      this.client = nextContext.client;
    }

    if (nextProps.skip) {
      return;
    }

    this.removeQuerySubscription();
    this.initializeQueryObservable(nextProps);
    this.startQuerySubscription();
    this.updateCurrentData();
  }

  componentWillUnmount() {
    this.removeQuerySubscription();
  }

  render() {
    const { children } = this.props;
    const queryResult = this.getQueryResult();

    if (this.props.skip) {
      const result = {
        ...queryResult,
        data: undefined,
        error: undefined,
        loading: false,
      };

      return children(result);
    }

    return children(queryResult);
  }

  private initializeQueryObservable = (
    props: QueryProps<TData, TVariables>,
  ) => {
    const {
      variables,
      pollInterval,
      fetchPolicy,
      errorPolicy,
      notifyOnNetworkStatusChange,
      query,
    } = props;

    const operation = parser(query);

    invariant(
      operation.type === DocumentType.Query,
      `The <Query /> component requires a graphql query, but got a ${
        operation.type === DocumentType.Mutation ? 'mutation' : 'subscription'
      }.`,
    );

    const clientOptions = {
      variables,
      pollInterval,
      query,
      fetchPolicy,
      errorPolicy,
      notifyOnNetworkStatusChange,
    };

    this.queryObservable = this.client.watchQuery(clientOptions);
  };

  private startQuerySubscription = () => {
    this.querySubscription = this.queryObservable.subscribe({
      next: this.updateCurrentData,
      error: error => {
        this.resubscribeToQuery();
        // Quick fix for https://github.com/apollostack/react-apollo/issues/378
        if (!error.hasOwnProperty('graphQLErrors')) throw error;

        this.updateCurrentData();
      },
    });
  };

  private removeQuerySubscription = () => {
    if (this.querySubscription) {
      this.querySubscription.unsubscribe();
    }
  };

  private resubscribeToQuery() {
    this.removeQuerySubscription();

    const lastError = this.queryObservable.getLastError();
    const lastResult = this.queryObservable.getLastResult();
    // If lastError is set, the observable will immediately
    // send it, causing the stream to terminate on initialization.
    // We clear everything here and restore it afterward to
    // make sure the new subscription sticks.
    this.queryObservable.resetLastResults();
    this.startQuerySubscription();
    Object.assign(this.queryObservable, { lastError, lastResult });
  }

  private updateCurrentData = () => {
    this.setState({ result: this.queryObservable.currentResult() });
  };

  private getQueryResult = (): QueryResult<TData, TVariables> => {
    const { result } = this.state;
    const { loading, networkStatus, errors } = result;
    let { error } = result;
    // until a set naming convention for networkError and graphQLErrors is decided upon, we map errors (graphQLErrors) to the error props
    if (errors && errors.length > 0) {
      error = new ApolloError({ graphQLErrors: errors });
    }
    let data = {} as any;

    if (loading) {
      Object.assign(data, this.previousData, result.data);
    } else if (error) {
      Object.assign(data, (this.queryObservable.getLastResult() || {}).data);
    } else {
      data = result.data;
      this.previousData = result.data;
    }

    return {
      client: this.client,
      data: isDataFilled(data) ? data : undefined,
      loading,
      error,
      networkStatus,
      ...observableQueryFields(this.queryObservable),
    };
  };
}

export default Query;
