import { Edit3, Plus, RefreshCw, Search } from 'lucide-react'
import type { AgentCustomer, AgentListItem, AgentOverview } from '../../types'
import { WorkspaceHeader, WorkspaceToolbar } from '../workspace'

type SearchScope = 'all' | 'agents' | 'customers'

type AgentWorkspaceControlsProps = {
  agents: AgentListItem[]
  overview: AgentOverview | null
  selectedMembershipId: string
  workspaceSearch: string
  searchScope: SearchScope
  searchResults: { agents: AgentListItem[]; customers: AgentCustomer[] }
  loading: boolean
  canEditProfile: boolean
  canRegisterCustomers: boolean
  canPostTransactions: boolean
  onWorkspaceSearchChange: (value: string) => void
  onSearchScopeChange: (value: SearchScope) => void
  onSelectAgent: (membershipId: string) => void
  onSelectCustomer: (customer: AgentCustomer) => void
  onRefresh: () => void
  onEditProfile: () => void
  onRegisterCustomer: () => void
  onAddTransaction: () => void
}

export function AgentWorkspaceControls({
  agents,
  overview,
  selectedMembershipId,
  workspaceSearch,
  searchScope,
  searchResults,
  loading,
  canEditProfile,
  canRegisterCustomers,
  canPostTransactions,
  onWorkspaceSearchChange,
  onSearchScopeChange,
  onSelectAgent,
  onSelectCustomer,
  onRefresh,
  onEditProfile,
  onRegisterCustomer,
  onAddTransaction,
}: AgentWorkspaceControlsProps) {
  return <>
    <WorkspaceHeader
      eyebrow="Sales network"
      title="Agent overview"
      description="Review assigned customers, agent balances and transaction history from one workspace."
      actions={<div className="agent-page__actions">
        <button type="button" className="secondary-button secondary-button--icon" onClick={onRefresh} disabled={loading} aria-label="Refresh agent overview">
          <RefreshCw className={loading ? 'spin' : ''} size={16} /> Refresh
        </button>
        {overview && canEditProfile && <button type="button" className="secondary-button secondary-button--icon" onClick={onEditProfile}><Edit3 size={16} /> Edit profile</button>}
        {overview && canRegisterCustomers && <button type="button" className="secondary-button secondary-button--icon" onClick={onRegisterCustomer}><Plus size={16} /> Register customer</button>}
        {overview && canPostTransactions && <button type="button" className="primary-button primary-button--compact" onClick={onAddTransaction}><Plus size={17} /> Add transaction</button>}
      </div>}
    />

    <WorkspaceToolbar className="agent-workspace-toolbar">
      <div className="agent-global-search">
        <Search size={17} />
        <input
          value={workspaceSearch}
          onChange={(event) => onWorkspaceSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onWorkspaceSearchChange('')
          }}
          placeholder="Search agents or customers"
          aria-label="Search agents or customers"
        />
        <select value={searchScope} onChange={(event) => onSearchScopeChange(event.target.value as SearchScope)} aria-label="Search scope">
          <option value="all">All</option>
          <option value="agents">Agents</option>
          <option value="customers">Customers</option>
        </select>

        {workspaceSearch.trim() && (
          <div className="agent-search-results">
            {searchResults.agents.length > 0 && (
              <section>
                <span>Agents</span>
                {searchResults.agents.map((agent) => (
                  <button type="button" key={agent.membership_id} onClick={() => onSelectAgent(agent.membership_id)}>
                    <div className="avatar avatar--small">{agent.full_name.slice(0, 1).toUpperCase()}</div>
                    <span><strong>{agent.full_name}</strong><small>{agent.email} · {agent.customer_count} customers</small></span>
                  </button>
                ))}
              </section>
            )}
            {searchResults.customers.length > 0 && (
              <section>
                <span>Customers</span>
                {searchResults.customers.map((customer) => (
                  <button type="button" key={customer.id} onClick={() => onSelectCustomer(customer)}>
                    <div className="customer-avatar">{customer.customer_name.slice(0, 1).toUpperCase()}</div>
                    <span><strong>{customer.customer_name}</strong><small>{customer.consumer_number || customer.project_name || customer.customer_type}</small></span>
                  </button>
                ))}
              </section>
            )}
            {searchResults.agents.length === 0 && searchResults.customers.length === 0 && (
              <div className="agent-search-results__empty">No matching agents or customers</div>
            )}
          </div>
        )}
      </div>

      {agents.length > 1 && (
        <label className="agent-toolbar-picker">
          <span>Agent</span>
          <select value={selectedMembershipId} onChange={(event) => onSelectAgent(event.target.value)}>
            {agents.map((agent) => <option key={agent.membership_id} value={agent.membership_id}>{agent.full_name} · {agent.customer_count} customers</option>)}
          </select>
        </label>
      )}
    </WorkspaceToolbar>
  </>
}
