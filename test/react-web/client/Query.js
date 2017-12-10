import React from 'react';
import ApolloClient from 'apollo-client';
import gql from 'graphql-tag';
import { mount } from 'enzyme';

import ApolloProvider from '../../../src/ApolloProvider';
import Query from '../../../src/Query';
import { MockedProvider } from '../../../src/test-utils';

const query = gql`
  query people {
    allPeople(first: 1) {
      people {
        name
      }
    }
  }
`;
const data = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };

const mocks = [
  {
    request: { query },
    result: { data },
  },
];

const options = {
  query,
};

const catchAsyncError = (done, cb) => {
  try {
    cb();
  } catch (e) {
    done.fail(e);
  }
};

class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    console.log(error);
    console.log(errorInfo);
  }

  render() {
    return this.props.children;
  }
}

describe('Query component', () => {
  it('calls the render prop', done => {
    const Component = () => (
      <Query
        query={query}
        loading={() => <div />}
        error={() => <div />}
        render={result => {
          catchAsyncError(done, () => {
            expect(result).toMatchSnapshot('result in render prop');
            done();
          });

          return null;
        }}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('renders using the render prop', done => {
    const onRender = () => {
      setTimeout(() => {
        catchAsyncError(done, () => {
          wrapper.update();
          expect(wrapper.find('#loading').exists()).toBeFalsy();
          expect(wrapper.find('#data').exists()).toBeTruthy();
          done();
        });
      }, 0);
    };

    const Component = () => (
      <Query
        query={query}
        loading={() => <div id="loading" />}
        render={result => {
          onRender();
          return <div id="data" />;
        }}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
    catchAsyncError(done, () => {
      expect(wrapper.find('#loading').exists()).toBeTruthy();
    });
  });

  it('renders the error state', done => {
    const mockError = [
      {
        request: { query },
        error: new Error('error occurred'),
      },
    ];

    const Component = () => (
      <Query
        query={query}
        error={e => {
          onError(e);
          return <div id="error" />;
        }}
        render={result => <div id="data" />}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mockError} removeTypename>
        <Component />
      </MockedProvider>,
    );

    const onError = e => {
      catchAsyncError(done, () => {
        expect(e).toEqual(new Error('Network error: error occurred'));
      });

      setTimeout(() => {
        catchAsyncError(done, () => {
          wrapper.update();
          expect(wrapper.find('#error').exists()).toBeTruthy();
          expect(wrapper.find('#data').exists()).toBeFalsy();
          done();
        });
      }, 0);
    };
  });

  it('skips the query', done => {
    const render = jest.fn(() => null);

    const Component = () => <Query query={query} skip render={render} />;

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );

    setTimeout(() => {
      catchAsyncError(done, () => {
        expect(render).toHaveBeenCalledTimes(1);
        done();
      });
    }, 0);
  });

  it('includes variables in the render props', done => {
    const queryWithVariables = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;

    const mocksWithVariable = [
      {
        request: {
          query: queryWithVariables,
          // TODO: Currently, removing this variables field does not crash the test. We need to verify
          // that the variables are included in the request.
          variables: {
            first: 1,
          },
        },
        result: { data },
      },
    ];

    const render = jest.fn(() => null);

    const options = {
      variables: {
        first: 1,
      },
    };

    const Component = () => (
      <Query query={queryWithVariables} options={options} render={render} />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocksWithVariable} removeTypename>
        <Component />
      </MockedProvider>,
    );

    setTimeout(() => {
      catchAsyncError(done, () => {
        expect(render.mock.calls[0][0].variables).toEqual({ first: 1 });
        done();
      });
    }, 0);
  });

  it('provides a refetch render prop', done => {
    const queryRefetch = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };
    const data3 = { allPeople: { people: [{ name: 'Darth Vader' }] } };

    const variables = {
      first: 1,
    };

    const mocks = [
      {
        request: { query: queryRefetch, variables },
        result: { data: data1 },
      },
      {
        request: { query: queryRefetch, variables },
        result: { data: data2 },
      },
      {
        request: { query: queryRefetch, variables: { first: 2 } },
        result: { data: data3 },
      },
    ];

    let count = 0;
    let hasRefetched = false;

    const options = {
      variables,
    };

    expect.assertions(8);

    const Component = () => (
      <Query
        query={queryRefetch}
        options={options}
        loading={() => {
          count++;
          return null;
        }}
        render={data => {
          catchAsyncError(done, () => {
            if (count === 1) {
              // first data
              expect(data.variables).toEqual({ first: 1 });
              expect(data.data).toEqual(data1);
            }
            // TODO: Should this count be 3? Why is there is no loading state between first and second data?
            if (count === 2) {
              // second data
              expect(data.variables).toEqual({ first: 1 });
              expect(data.data).toEqual(data2);
            }
            if (count === 4) {
              // third data
              expect(data.variables).toEqual({ first: 2 });
              expect(data.data).toEqual(data3);
            }
          });

          count++;
          if (hasRefetched) {
            return null;
          }

          hasRefetched = true;
          data
            .refetch()
            .then(result => {
              expect(result.data).toEqual(data2);
              return data.refetch({ first: 2 });
            })
            .then(result2 => {
              expect(result2.data).toEqual(data3);
              done();
            })
            .catch(done.fail);

          return null;
        }}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('provides a fetchMore render prop', done => {
    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };

    const variables = {
      first: 2,
    };

    const mocks = [
      {
        request: { query, variables: { first: 2 } },
        result: { data: data1 },
      },
      {
        request: { query, variables: { first: 1 } },
        result: { data: data2 },
      },
    ];

    let count = 0;
    expect.assertions(3);

    const Component = () => (
      <Query
        query={query}
        options={{ variables }}
        loading={() => null}
        render={data => {
          if (count === 0) {
            data
              .fetchMore({
                variables: { first: 1 },
                updateQuery: (prev, { fetchMoreResult }) => ({
                  allPeople: {
                    people: [
                      ...prev.allPeople.people,
                      ...fetchMoreResult.allPeople.people,
                    ],
                  },
                }),
              })
              .then(result => {
                expect(result.data).toEqual(data2);
              })
              .catch(done.fail);
          } else if (count === 1) {
            catchAsyncError(done, () => {
              expect(data.variables).toEqual(variables);

              expect(data.data).toEqual({
                allPeople: {
                  people: [
                    ...data1.allPeople.people,
                    ...data2.allPeople.people,
                  ],
                },
              });
              done();
            });
          }

          count++;
          return null;
        }}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('provides startPolling in the render prop', done => {
    expect.assertions(4);

    const options = {
      pollInterval: 30,
    };

    let count = 0;

    const Component = () => (
      <Query
        query={query}
        options={options}
        loading={() => <div />}
        render={result => {
          if (count === 0) {
            expect(result.data).toEqual(data1);
          } else if (count === 1) {
            expect(result.data).toEqual(data2);
          } else if (count === 2) {
            expect(result.data).toEqual(data3);
          }
          count++;
          return null;
        }}
      />
    );

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };
    const data3 = { allPeople: { people: [{ name: 'Darth Vader' }] } };

    const mocks = [
      {
        request: { query },
        result: { data: data1 },
      },
      {
        request: { query },
        result: { data: data2 },
      },
      {
        request: { query },
        result: { data: data3 },
      },
    ];

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );

    setTimeout(() => {
      catchAsyncError(done, () => {
        expect(count).toBe(3);
        wrapper.unmount();
        done();
      });
    }, 80);
  });

  it('provides stopPolling in the render prop', done => {
    expect.assertions(3);

    const options = {
      pollInterval: 30,
    };

    let count = 0;

    const Component = () => (
      <Query
        query={query}
        options={options}
        loading={() => <div />}
        render={result => {
          if (count === 0) {
            expect(result.data).toEqual(data1);
          } else if (count === 1) {
            expect(result.data).toEqual(data2);
            result.stopPolling();
          }
          count++;
          return null;
        }}
      />
    );

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };
    const data3 = { allPeople: { people: [{ name: 'Darth Vader' }] } };

    const mocks = [
      {
        request: { query },
        result: { data: data1 },
      },
      {
        request: { query },
        result: { data: data2 },
      },
      {
        request: { query },
        result: { data: data3 },
      },
    ];

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );

    setTimeout(() => {
      catchAsyncError(done, () => {
        expect(count).toBe(2);
        wrapper.unmount();
        done();
      });
    }, 100);
  });

  it('provides updateQuery render prop', done => {
    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };
    const mocks = [
      {
        request: { query, variables },
        result: { data: data1 },
      },
    ];

    const variables = {
      first: 2,
    };
    let isUpdated;
    expect.assertions(3);
    const Component = () => (
      <Query
        query={query}
        options={{ variables }}
        loading={() => <div />}
        render={result => {
          if (isUpdated) {
            catchAsyncError(done, () => {
              expect(result.data).toEqual(data2);
              done();
            });

            return null;
          }
          isUpdated = true;
          setTimeout(() => {
            result.updateQuery((prev, { variables: variablesUpdate }) => {
              catchAsyncError(done, () => {
                expect(prev).toEqual(data1);
                expect(variablesUpdate).toEqual({ first: 2 });
              });

              return data2;
            });
          }, 0);

          return null;
        }}
      />
    );

    const wrapper = mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('should update if the options change', done => {
    const query = gql`
      query people($first: Int) {
        allPeople(first: $first) {
          people {
            name
          }
        }
      }
    `;

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo' }] } };
    const mocks = [
      {
        request: { query, variables: { first: 1 } },
        result: { data: data1 },
      },
      {
        request: { query, variables: { first: 2 } },
        result: { data: data2 },
      },
    ];

    let count = 0;

    class Component extends React.Component {
      state = {
        variables: {
          first: 1,
        },
      };

      componentDidMount() {
        setTimeout(() => {
          this.setState({
            variables: {
              first: 2,
            },
          });
        }, 50);
      }

      render() {
        const { variables } = this.state;

        return (
          <Query
            query={query}
            options={{ variables }}
            loading={() => <div />}
            render={result => {
              catchAsyncError(done, () => {
                if (count === 0) {
                  expect(result.variables).toEqual({ first: 1 });
                  expect(result.data).toEqual(data1);
                }
                if (count === 1) {
                  expect(result.variables).toEqual({ first: 2 });
                  expect(result.data).toEqual(data2);
                  done();
                }
              });

              count++;
              return null;
            }}
          />
        );
      }
    }

    mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('should update if the query changes', done => {
    expect.assertions(2);
    const query1 = query;
    const query2 = gql`
      query people {
        allPeople(first: 1) {
          people {
            id
            name
          }
        }
      }
    `;

    const data1 = { allPeople: { people: [{ name: 'Luke Skywalker' }] } };
    const data2 = { allPeople: { people: [{ name: 'Han Solo', id: '1' }] } };
    const mocks = [
      {
        request: { query: query1 },
        result: { data: data1 },
      },
      {
        request: { query: query2 },
        result: { data: data2 },
      },
    ];

    let count = 0;

    class Component extends React.Component {
      state = {
        query: query1,
      };

      componentDidMount() {
        setTimeout(() => {
          this.setState({
            query: query2,
          });
        }, 50);
      }

      render() {
        const { query } = this.state;

        return (
          <Query
            query={query}
            loading={() => <div />}
            render={result => {
              catchAsyncError(done, () => {
                if (count === 0) {
                  expect(result.data).toEqual(data1);
                }
                if (count === 1) {
                  expect(result.data).toEqual(data2);
                  done();
                }
              });

              count++;
              return null;
            }}
          />
        );
      }
    }

    mount(
      <MockedProvider mocks={mocks} removeTypename>
        <Component />
      </MockedProvider>,
    );
  });

  it('should update if the skip flag changes', () => {});

  it('should update if the client changes', () => {});
});
