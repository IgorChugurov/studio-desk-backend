/** Fitness Studio starter preset. Stable across a wiped database. */
export const FITNESS_PRESET_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Inserts an organization and copies the Fitness Studio preset into it.
 * Parameters: name, subdomain, owner email, status.
 */
export const INSERT_ORGANIZATION = `
with source as (
  select id, name, sections, catalog_config, schedule_config, billing_config
    from preset
   where name = 'Fitness Studio'
),
created as (
  insert into organization (
    name, subdomain, owner_email, status,
    preset_id, preset_name, schedule_config, billing_config
  )
  select $1, $2, $3, $4,
         source.id, source.name, source.schedule_config, source.billing_config
    from source
  returning id
),
copied_sections as (
  insert into organization_section (organization_id, section)
  select created.id, section.value
    from created
    cross join source
    cross join lateral jsonb_array_elements_text(source.sections) as section(value)
),
copied_types as (
  insert into organization_resource_type (
    organization_id, sort_order, role, labels,
    geography, duration, showcase, person, skills, required, multiple, conflict_mode
  )
  select created.id,
         (item.ordinality - 1)::int,
         item.type->>'role',
         item.type->'labels',
         (item.type->>'geography')::boolean,
         (item.type->>'duration')::boolean,
         (item.type->>'showcase')::boolean,
         (item.type->>'person')::boolean,
         (item.type->>'skills')::boolean,
         (item.type->>'required')::boolean,
         (item.type->>'multiple')::boolean,
         item.type->>'conflictMode'
    from created
    cross join source
    cross join lateral jsonb_array_elements(source.catalog_config->'resourceTypes')
      with ordinality as item(type, ordinality)
)
select id from created
`;
