import axios from 'axios';

const API_BASE_URL = 'https://api.congress.gov/v3';
const API_KEY = import.meta.env.VITE_CONGRESS_API_KEY;

if (!API_KEY) {
  throw new Error('Congress.gov API key is required');
}

const api = axios.create({
  baseURL: API_BASE_URL,
  params: {
    api_key: API_KEY,
    format: 'json',
  },
});

export interface BillParams {
  offset?: number;
  limit?: number;
  fromDateTime?: string;
  toDateTime?: string;
  query?: string;
  status?: string;
  chamber?: string;
  congress?: string;
  billType?: string;
}

export interface MemberParams {
  offset?: number;
  limit?: number;
  congress?: number;
  chamber?: string;
  state?: string;
  district?: string;
  party?: string;
  query?: string;
}

export interface PaginatedResponse<T> {
  request: {
    offset: number;
    limit: number;
    count: number;
  };
  pagination?: {
    next?: string;
    previous?: string;
    count: number;
    totalCount: number;
  };
  [key: string]: any;
}

const BILL_TYPES = ['HR', 'S', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES', 'HRES', 'SRES'];

export const getBills = async (params: BillParams = {}): Promise<PaginatedResponse<any>> => {
  try {
    const requests = [];
    const { congress, billType } = params;

    if (congress && billType) {
      requests.push(
        api.get(`/bill/${congress}/${billType.toUpperCase()}`, {
          params: {
            ...params,
            detail: 'summary',
            sort: 'updateDate+desc'
          }
        })
      );
    } else if (congress) {
      BILL_TYPES.forEach(type => {
        requests.push(
          api.get(`/bill/${congress}/${type}`, {
            params: {
              ...params,
              detail: 'summary',
              sort: 'updateDate+desc',
              limit: Math.floor(params.limit || 20 / BILL_TYPES.length)
            }
          })
        );
      });
    } else {
      requests.push(
        api.get('/bill', {
          params: {
            ...params,
            detail: 'summary',
            sort: 'updateDate+desc'
          }
        })
      );
    }

    const responses = await Promise.all(requests.map(p => p.catch(e => e)));
    const validResponses = responses.filter(r => !(r instanceof Error));

    let allBills = validResponses.flatMap(response => {
      const bills = response.data?.bills || [];
      return bills.map(bill => ({
        ...bill,
        type: bill.type?.toUpperCase(),
        status: bill.status || ''
      }));
    });

    if (params.query) {
      const searchTerm = params.query.toLowerCase();
      allBills = allBills.filter(bill => 
        bill.title?.toLowerCase().includes(searchTerm) ||
        bill.summary?.toLowerCase().includes(searchTerm)
      );
    }

    if (params.status) {
      allBills = allBills.filter(bill => 
        bill.status.toLowerCase().includes(params.status!.toLowerCase())
      );
    }

    const uniqueBills = Array.from(
      new Map(allBills.map(bill => [
        `${bill.congress}-${bill.type}-${bill.number}`,
        bill
      ])).values()
    );

    uniqueBills.sort((a, b) => 
      new Date(b.updateDate || '').getTime() - new Date(a.updateDate || '').getTime()
    );

    const offset = params.offset || 0;
    const limit = params.limit || 20;
    const paginatedBills = uniqueBills.slice(offset, offset + limit);

    if (!params.detail || params.detail !== 'summary') {
      return {
        request: {
          offset,
          limit,
          count: paginatedBills.length
        },
        pagination: {
          count: paginatedBills.length,
          totalCount: uniqueBills.length
        },
        bills: paginatedBills
      };
    }

    const summaryRequests = paginatedBills.map(bill => 
      api.get(`/bill/${bill.congress}/${bill.type}/${bill.number}/summaries`)
        .then(response => ({
          billId: `${bill.congress}-${bill.type}-${bill.number}`,
          summaries: response.data.summaries || []
        }))
        .catch(() => ({
          billId: `${bill.congress}-${bill.type}-${bill.number}`,
          summaries: []
        }))
    );

    const summaryResults = await Promise.all(summaryRequests);
    
    const summariesByBillId = new Map(
      summaryResults.map(result => [result.billId, result.summaries])
    );

    const billsWithSummaries = paginatedBills.map(bill => {
      const billId = `${bill.congress}-${bill.type}-${bill.number}`;
      return {
        ...bill,
        summaries: summariesByBillId.get(billId) || []
      };
    });

    return {
      request: {
        offset,
        limit,
        count: billsWithSummaries.length
      },
      pagination: {
        count: billsWithSummaries.length,
        totalCount: uniqueBills.length
      },
      bills: billsWithSummaries
    };
  } catch (error) {
    console.error('Error fetching bills:', error);
    throw error;
  }
};

export const getBillDetails = async (congress: string, type: string, number: string) => {
  try {
    const detailsResponse = await api.get(`/bill/${congress}/${type.toUpperCase()}/${number}`, {
      params: {
        detail: 'all'
      }
    });

    if (!detailsResponse.data?.bill) {
      throw new Error('Failed to fetch bill details');
    }

    const bill = detailsResponse.data.bill;

    const fetchSubResource = async (endpoint: string) => {
      try {
        const response = await api.get(endpoint);
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          const resourceType = endpoint.split('/').pop() || '';
          console.log(`Resource not found (404), returning empty array for: ${endpoint}`);
          return { [resourceType]: [] };
        }
        console.warn(`Failed to fetch ${endpoint}:`, error);
        return { [endpoint.split('/').pop() || '']: [] };
      }
    };

    const [actionsData, summariesData, cosponsorsData] = await Promise.all([
      fetchSubResource(`/bill/${congress}/${type.toUpperCase()}/${number}/actions`),
      fetchSubResource(`/bill/${congress}/${type.toUpperCase()}/${number}/summaries`),
      fetchSubResource(`/bill/${congress}/${type.toUpperCase()}/${number}/cosponsors`)
    ]);

    const actions = Array.isArray(actionsData?.actions) ? actionsData.actions : [];
    const summaries = Array.isArray(summariesData?.summaries) ? summariesData.summaries : [];
    const cosponsors = Array.isArray(cosponsorsData?.cosponsors) ? cosponsorsData.cosponsors : [];

    const sortedActions = actions.length > 0
      ? [...actions].sort((a, b) => new Date(b.actionDate).getTime() - new Date(a.actionDate).getTime())
      : [];

    const sortedSummaries = summaries.length > 0
      ? [...summaries].sort((a, b) => new Date(b.updateDate).getTime() - new Date(a.updateDate).getTime())
      : [];

    const sortedCosponsors = cosponsors.length > 0
      ? [...cosponsors].sort((a, b) => new Date(b.sponsorshipDate).getTime() - new Date(a.sponsorshipDate).getTime())
      : [];

    console.log('📊 Bill Data Availability:', {
      details: !!bill,
      actions: actions.length,
      summaries: summaries.length,
      cosponsors: cosponsors.length
    });

    return {
      bill: {
        ...bill,
        type: bill.type?.toUpperCase(),
        actions: sortedActions,
        summaries: sortedSummaries,
        cosponsors: sortedCosponsors
      }
    };
  } catch (error) {
    console.error('Error fetching bill details:', error);
    throw error;
  }
};

export const getMembers = async (params: MemberParams = {}) => {
  try {
    const response = await api.get('/member', {
      params: {
        ...params,
        limit: params.limit || 50,
        detail: 'full'
      }
    });

    const members = response.data.members?.map((member: any) => ({
      ...member,
      firstName: member.firstName || member.name?.split(' ')[0] || '',
      lastName: member.lastName || member.name?.split(' ').slice(1).join(' ') || '',
      fullName: member.name || `${member.firstName} ${member.lastName}`.trim(),
      state: member.state || '',
      party: member.party || '',
      chamber: member.chamber || '',
      district: member.district || null
    })) || [];

    return {
      ...response.data,
      members
    };
  } catch (error) {
    console.error('Error fetching members:', error);
    throw error;
  }
};

export const getMemberDetails = async (bioguideId: string) => {
  try {
    const [memberResponse, sponsoredBillsResponse] = await Promise.all([
      api.get(`/member/${bioguideId}`),
      api.get(`/member/${bioguideId}/sponsored-legislation`)
    ]);

    const member = memberResponse.data.member;
    const sponsoredBills = sponsoredBillsResponse.data.sponsoredLegislation || [];

    return {
      member: {
        ...member,
        sponsoredBills
      }
    };
  } catch (error) {
    console.error('Error fetching member details:', error);
    throw error;
  }
};